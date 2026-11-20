use std::collections::VecDeque;
use std::f32::consts::PI;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::{AppHandle, Emitter};

use crate::models::BeatFrame;

const FFT_SIZE: usize = 1024;

struct RingAudioBuffer {
    buf: Vec<f32>,
    write_idx: usize,
    filled: bool,
}

impl RingAudioBuffer {
    fn new(cap: usize) -> Self {
        Self {
            buf: vec![0.0; cap],
            write_idx: 0,
            filled: false,
        }
    }

    fn push_sample(&mut self, sample: f32) {
        self.buf[self.write_idx] = sample;
        self.write_idx += 1;
        if self.write_idx >= self.buf.len() {
            self.write_idx = 0;
            self.filled = true;
        }
    }

    fn copy_ordered(&self, dst: &mut [f32]) -> bool {
        if !self.filled || dst.len() != self.buf.len() {
            return false;
        }
        let tail = self.buf.len() - self.write_idx;
        dst[..tail].copy_from_slice(&self.buf[self.write_idx..]);
        dst[tail..].copy_from_slice(&self.buf[..self.write_idx]);
        true
    }
}

pub struct AudioBeatEngine {
    should_capture: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    wake_lock: Arc<Mutex<()>>,
    wake_cv: Arc<Condvar>,
    latest: Arc<Mutex<BeatFrame>>,
}

impl AudioBeatEngine {
    pub fn start(app: AppHandle) -> Self {
        let should_capture = Arc::new(AtomicBool::new(false));
        let shutdown = Arc::new(AtomicBool::new(false));
        let wake_lock = Arc::new(Mutex::new(()));
        let wake_cv = Arc::new(Condvar::new());
        let latest = Arc::new(Mutex::new(BeatFrame::default()));

        let sc = Arc::clone(&should_capture);
        let sd = Arc::clone(&shutdown);
        let wl = Arc::clone(&wake_lock);
        let cv = Arc::clone(&wake_cv);
        let lt = Arc::clone(&latest);

        let _ = std::thread::Builder::new()
            .name("constellation-beat".to_string())
            .spawn(move || {
                capture_thread(app, sc, sd, wl, cv, lt);
            });

        Self {
            should_capture,
            shutdown,
            wake_lock,
            wake_cv,
            latest,
        }
    }

    pub fn set_active(&self, active: bool) {
        let prev = self.should_capture.swap(active, Ordering::SeqCst);
        if prev != active {
            if let Ok(_guard) = self.wake_lock.lock() {
                self.wake_cv.notify_all();
            }
        }
    }

    pub fn current_frame(&self) -> BeatFrame {
        self.latest.lock().map(|g| *g).unwrap_or_default()
    }

    pub fn stop(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
        self.should_capture.store(false, Ordering::SeqCst);
        if let Ok(_guard) = self.wake_lock.lock() {
            self.wake_cv.notify_all();
        }
    }
}

impl Drop for AudioBeatEngine {
    fn drop(&mut self) {
        self.stop();
    }
}

fn capture_thread(
    app: AppHandle,
    should_capture: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    wake_lock: Arc<Mutex<()>>,
    wake_cv: Arc<Condvar>,
    latest: Arc<Mutex<BeatFrame>>,
) {
    let hann: Vec<f32> = (0..FFT_SIZE)
        .map(|i| 0.5 * (1.0 - (2.0 * PI * i as f32 / (FFT_SIZE - 1) as f32).cos()))
        .collect();

    loop {
        if shutdown.load(Ordering::SeqCst) {
            break;
        }

        if !should_capture.load(Ordering::SeqCst) {
            if let Ok(mut g) = latest.lock() {
                if *g != BeatFrame::default() {
                    *g = BeatFrame::default();
                    let _ = app.emit("beat-frame", BeatFrame::default());
                }
            }
            if let Ok(guard) = wake_lock.lock() {
                drop(wake_cv.wait_while(guard, |_| {
                    !should_capture.load(Ordering::SeqCst) && !shutdown.load(Ordering::SeqCst)
                }));
            }
            continue;
        }

        let ring = Arc::new(Mutex::new(RingAudioBuffer::new(FFT_SIZE)));
        let opened = open_audio_capture_stream(Arc::clone(&ring));
        let Some((stream, sample_rate)) = opened else {
            // Graceful fallback when no loopback/input device is available
            std::thread::sleep(Duration::from_secs(2));
            continue;
        };

        if stream.play().is_err() {
            drop(stream);
            std::thread::sleep(Duration::from_secs(2));
            continue;
        }

        let mut history: VecDeque<f32> = VecDeque::with_capacity(42);
        let mut smooth_bass = 0.0_f32;
        let mut smooth_mid = 0.0_f32;
        let mut smooth_treble = 0.0_f32;
        let mut smooth_energy = 0.0_f32;
        let mut beat_pulse = 0.0_f32;
        let mut peak_ref = 0.02_f32;
        let mut samples = vec![0.0_f32; FFT_SIZE];
        let mut re = vec![0.0_f32; FFT_SIZE];
        let mut im = vec![0.0_f32; FFT_SIZE];

        while should_capture.load(Ordering::SeqCst) && !shutdown.load(Ordering::SeqCst) {
            let ready = ring
                .lock()
                .map(|r| r.copy_ordered(&mut samples))
                .unwrap_or(false);

            if ready {
                let mut sum_sq = 0.0_f32;
                for i in 0..FFT_SIZE {
                    let v = samples[i] * hann[i];
                    re[i] = v;
                    im[i] = 0.0;
                    sum_sq += v * v;
                }
                let rms = (sum_sq / FFT_SIZE as f32).sqrt();

                fft_radix2(&mut re, &mut im);

                let bin_hz = sample_rate as f32 / FFT_SIZE as f32;
                let half = FFT_SIZE / 2;

                let (mut bass_sum, mut bass_n) = (0.0_f32, 0usize);
                let (mut mid_sum, mut mid_n) = (0.0_f32, 0usize);
                let (mut treb_sum, mut treb_n) = (0.0_f32, 0usize);

                for k in 1..half {
                    let freq = k as f32 * bin_hz;
                    let mag = (re[k] * re[k] + im[k] * im[k]).sqrt();
                    if (25.0..=160.0).contains(&freq) {
                        bass_sum += mag;
                        bass_n += 1;
                    } else if (160.0..=2000.0).contains(&freq) {
                        mid_sum += mag;
                        mid_n += 1;
                    } else if (2000.0..=10000.0).contains(&freq) {
                        treb_sum += mag;
                        treb_n += 1;
                    }
                }

                let raw_bass = if bass_n > 0 {
                    bass_sum / bass_n as f32
                } else {
                    0.0
                };
                let raw_mid = if mid_n > 0 {
                    mid_sum / mid_n as f32
                } else {
                    0.0
                };
                let raw_treb = if treb_n > 0 {
                    treb_sum / treb_n as f32
                } else {
                    0.0
                };

                peak_ref = peak_ref.mul_add(0.992, 0.0).max(0.015).max(raw_bass);
                let norm_bass = (raw_bass / (peak_ref * 0.85)).clamp(0.0, 1.0);
                let norm_mid = (raw_mid / (peak_ref * 0.65)).clamp(0.0, 1.0);
                let norm_treb = (raw_treb / (peak_ref * 0.45)).clamp(0.0, 1.0);
                let norm_energy = (rms * 5.0).clamp(0.0, 1.0);

                if history.len() >= 40 {
                    history.pop_front();
                }
                history.push_back(norm_bass);
                let avg_bass = history.iter().sum::<f32>() / history.len().max(1) as f32;

                if norm_bass > (avg_bass * 1.28).max(0.18) {
                    let onset = ((norm_bass - avg_bass) * 2.6 + 0.35).min(1.0);
                    beat_pulse = beat_pulse.max(onset);
                } else {
                    beat_pulse *= 0.82;
                }

                smooth_bass = smooth_bass * 0.65 + norm_bass * 0.35;
                smooth_mid = smooth_mid * 0.65 + norm_mid * 0.35;
                smooth_treble = smooth_treble * 0.65 + norm_treb * 0.35;
                smooth_energy = smooth_energy * 0.65 + norm_energy * 0.35;

                let frame = BeatFrame {
                    beat: round3_f32(beat_pulse),
                    bass: round3_f32(smooth_bass),
                    mid: round3_f32(smooth_mid),
                    treble: round3_f32(smooth_treble),
                    energy: round3_f32(smooth_energy),
                };

                if let Ok(mut g) = latest.lock() {
                    *g = frame;
                }
                let _ = app.emit("beat-frame", frame);
            }

            std::thread::sleep(Duration::from_millis(28));
        }

        // Explicitly drop the audio stream when paused or hidden
        drop(stream);
    }
}

fn open_audio_capture_stream(
    ring: Arc<Mutex<RingAudioBuffer>>,
) -> Option<(cpal::Stream, u32)> {
    let host = cpal::default_host();

    #[cfg(target_os = "windows")]
    {
        if let Some(out_dev) = host.default_output_device() {
            if let Ok(supported) = out_dev.default_output_config() {
                let sr = supported.sample_rate().0;
                let channels = supported.channels() as usize;
                let fmt = supported.sample_format();
                let cfg: cpal::StreamConfig = supported.into();
                if let Some(stream) =
                    build_input_stream_for_format(&out_dev, &cfg, fmt, channels, Arc::clone(&ring))
                {
                    return Some((stream, sr));
                }
            }
        }
        return None;
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Only capture from explicit audio monitor/loopback sources; never open user microphones
        if let Ok(devices) = host.input_devices() {
            for dev in devices {
                let name = dev.name().unwrap_or_default().to_ascii_lowercase();
                if name.contains("monitor") || name.contains("loopback") {
                    if let Ok(supported) = dev.default_input_config() {
                        let sr = supported.sample_rate().0;
                        let channels = supported.channels() as usize;
                        let fmt = supported.sample_format();
                        let cfg: cpal::StreamConfig = supported.into();
                        if let Some(stream) =
                            build_input_stream_for_format(&dev, &cfg, fmt, channels, Arc::clone(&ring))
                        {
                            return Some((stream, sr));
                        }
                    }
                }
            }
        }
        None
    }
}

fn build_input_stream_for_format(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    format: cpal::SampleFormat,
    channels: usize,
    ring: Arc<Mutex<RingAudioBuffer>>,
) -> Option<cpal::Stream> {
    let ch = channels.max(1);
    let err_fn = |_err| {};

    match format {
        cpal::SampleFormat::F32 => device
            .build_input_stream(
                config,
                move |data: &[f32], _| {
                    if let Ok(mut r) = ring.lock() {
                        for frame in data.chunks(ch) {
                            let mono = frame.iter().copied().sum::<f32>() / frame.len() as f32;
                            r.push_sample(mono);
                        }
                    }
                },
                err_fn,
                None,
            )
            .ok(),
        cpal::SampleFormat::I16 => device
            .build_input_stream(
                config,
                move |data: &[i16], _| {
                    if let Ok(mut r) = ring.lock() {
                        for frame in data.chunks(ch) {
                            let mono = frame
                                .iter()
                                .map(|&s| s as f32 / i16::MAX as f32)
                                .sum::<f32>()
                                / frame.len() as f32;
                            r.push_sample(mono);
                        }
                    }
                },
                err_fn,
                None,
            )
            .ok(),
        cpal::SampleFormat::U16 => device
            .build_input_stream(
                config,
                move |data: &[u16], _| {
                    if let Ok(mut r) = ring.lock() {
                        for frame in data.chunks(ch) {
                            let mono = frame
                                .iter()
                                .map(|&s| (s as f32 - 32768.0) / 32768.0)
                                .sum::<f32>()
                                / frame.len() as f32;
                            r.push_sample(mono);
                        }
                    }
                },
                err_fn,
                None,
            )
            .ok(),
        _ => None,
    }
}

fn fft_radix2(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }

    let mut len = 2usize;
    while len <= n {
        let ang = -2.0 * PI / len as f32;
        let wlen_re = ang.cos();
        let wlen_im = ang.sin();
        let half = len / 2;

        for i in (0..n).step_by(len) {
            let mut w_re = 1.0_f32;
            let mut w_im = 0.0_f32;
            for k in 0..half {
                let u_re = re[i + k];
                let u_im = im[i + k];
                let v_re = re[i + k + half] * w_re - im[i + k + half] * w_im;
                let v_im = re[i + k + half] * w_im + im[i + k + half] * w_re;
                re[i + k] = u_re + v_re;
                im[i + k] = u_im + v_im;
                re[i + k + half] = u_re - v_re;
                im[i + k + half] = u_im - v_im;

                let next_w_re = w_re * wlen_re - w_im * wlen_im;
                w_im = w_re * wlen_im + w_im * wlen_re;
                w_re = next_w_re;
            }
        }
        len <<= 1;
    }
}

fn round3_f32(v: f32) -> f32 {
    (v * 1000.0).round() / 1000.0
}

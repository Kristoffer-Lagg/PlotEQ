// Iterative radix-2 Cooley–Tukey FFT (in-place, complex).
//
// Operates on parallel real and imaginary arrays (Array or Float64Array),
// both of length n where n is a power of 2.
//
// fft(re, im)  — forward transform, in-place.
// ifft(re, im) — inverse transform, in-place, scaled by 1/n.
// nextPow2(n)  — smallest power of 2 ≥ n.
//
// No external dependencies. Accuracy is sufficient for audio-length transforms
// (tested up to 2^20 = ~1M points); twiddle-factor recurrence accumulates
// roundoff at ~1e-14 which is far below the noise floor of any real recording.

export function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function fft(re, im) {
  const n = re.length;
  if (n !== im.length) throw new Error('fft: re and im must be same length');
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('fft: length must be power of 2');

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  // Butterflies
  for (let size = 2; size <= n; size <<= 1) {
    const half  = size >> 1;
    const theta = -2 * Math.PI / size;
    const wRe   = Math.cos(theta);
    const wIm   = Math.sin(theta);
    for (let i = 0; i < n; i += size) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = curRe * re[b] - curIm * im[b];
        const ti = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

export function ifft(re, im) {
  const n = re.length;
  // IFFT via conjugation: ifft(x) = conj(fft(conj(x))) / n
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  const invN = 1 / n;
  for (let i = 0; i < n; i++) {
    re[i] =  re[i] * invN;
    im[i] = -im[i] * invN;
  }
}

"""Analyse d'une référence : niveau par bande dans le temps, coups (onsets), tempo."""

import sys
import wave

import numpy as np

w = wave.open(sys.argv[1])
sr = w.getframerate()
x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
hop, N = 256, 1024
trames = np.lib.stride_tricks.sliding_window_view(x, N)[::hop] * np.hanning(N)
S = np.abs(np.fft.rfft(trames, axis=1))
f = np.fft.rfftfreq(N, 1 / sr)
bandes = {
    "grave<150": f < 150,
    "tambour150-800": (f >= 150) & (f < 800),
    "medium800-3k": (f >= 800) & (f < 3000),
    "aigu>3k": f >= 3000,
}
E = {k: np.log10(1e-9 + (S[:, m] ** 2).sum(axis=1)) * 10 for k, m in bandes.items()}
t = np.arange(len(S)) * hop / sr

print("== niveau moyen par seconde (dB)")
print("  t  " + "".join(f"{k:>16s}" for k in E))
for s in range(int(t[-1])):
    m = (t >= s) & (t < s + 1)
    print(f"{s:3d}s " + "".join(f"{E[k][m].mean():16.1f}" for k in E))

# flux spectral -> coups
flux = np.maximum(0, np.diff(np.log1p(S * 10), axis=0)).sum(axis=1)
flux = np.concatenate([[0], flux])
seuil = np.convolve(flux, np.ones(40) / 40, mode="same") * 1.25
pics = [
    i
    for i in range(1, len(flux) - 1)
    if flux[i] > seuil[i] and flux[i] >= flux[i - 1] and flux[i] > flux[i + 1]
]
fin = float(sys.argv[2]) if len(sys.argv) > 2 else 20
print(f"\n== coups jusqu'à {fin}s : temps, force, bande dominante")
for i in pics:
    if t[i] > fin:
        break
    d = S[i] - S[max(0, i - 2)]
    dom = max(bandes, key=lambda k: np.maximum(0, d[bandes[k]]).sum())
    print(f"{t[i]:7.3f}  {flux[i]:6.1f}  {dom}")

# tempo par autocorrélation du flux
m = t < fin
fl = flux[m] - flux[m].mean()
ac = np.correlate(fl, fl, "full")[len(fl) - 1 :]
lags = np.arange(len(ac)) * hop / sr
zone = (lags > 60 / 200) & (lags < 60 / 60)
best = lags[zone][np.argmax(ac[zone])]
print(f"\n== tempo estimé : {60 / best:.1f} BPM")

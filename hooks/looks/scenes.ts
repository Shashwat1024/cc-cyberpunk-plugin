// Backdrop scenes: pure SVG with slow CSS motion. Every moving part has a
// resting place in the plain markup, so reduced motion still looks finished.

/** A small deterministic random, so the stars sit in the same places every load. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function stars(count: number): string {
  const rand = seeded(7)
  let out = ''
  for (let i = 0; i < count; i++) {
    const x = Math.round(rand() * 1600)
    // most stars in the sky above the words, a few lower at the sides
    const high = rand() < 0.75
    const y = high ? Math.round(rand() * 420) : Math.round(420 + rand() * 480)
    if (!high && x > 380 && x < 1220) continue
    const r = (0.6 + rand() * 1.4).toFixed(1)
    const cls = ['s1', 's2', 's3'][i % 3]
    out += `<circle class="star ${cls}" cx="${x}" cy="${y}" r="${r}" opacity="0.6"/>`
  }
  return out
}

export const AURORA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#090818"/>
<stop offset="0.55" stop-color="#110f27"/>
<stop offset="1" stop-color="#0e0c1f"/>
</linearGradient>
<linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#5fd3a0" stop-opacity="0"/>
<stop offset="0.45" stop-color="#5fd3a0" stop-opacity="0.22"/>
<stop offset="0.7" stop-color="#7fb8e6" stop-opacity="0.12"/>
<stop offset="1" stop-color="#8b7cf6" stop-opacity="0"/>
</linearGradient>
<linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#8b7cf6" stop-opacity="0"/>
<stop offset="0.5" stop-color="#8b7cf6" stop-opacity="0.2"/>
<stop offset="1" stop-color="#d08cf0" stop-opacity="0"/>
</linearGradient>
<linearGradient id="g3" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#4fd1c5" stop-opacity="0"/>
<stop offset="0.5" stop-color="#4fd1c5" stop-opacity="0.14"/>
<stop offset="1" stop-color="#4fd1c5" stop-opacity="0"/>
</linearGradient>
</defs>
<style>
.band{transform-box:fill-box;transform-origin:50% 50%;animation:drift 46s ease-in-out infinite alternate}
.b2{animation-duration:58s;animation-delay:-14s}
.b3{animation-duration:71s;animation-delay:-33s}
@keyframes drift{0%{transform:translateX(-70px) scaleY(0.9)}100%{transform:translateX(70px) scaleY(1.1)}}
.star{fill:#ece9ff;animation:twinkle 8s ease-in-out infinite alternate}
.s2{animation-duration:11s;animation-delay:-4s}
.s3{animation-duration:14s;animation-delay:-9s}
@keyframes twinkle{0%{opacity:0.25}100%{opacity:0.85}}
</style>
<rect width="1600" height="1000" fill="url(#sky)"/>
<path class="band" fill="url(#g1)" d="M-120 120 C 180 40, 430 260, 760 150 S 1270 40, 1720 170 L 1720 470 C 1320 330, 1010 500, 720 400 S 220 330, -120 470 Z"/>
<path class="band b2" fill="url(#g2)" d="M-120 60 C 260 160, 560 -10, 900 100 S 1400 220, 1720 90 L 1720 330 C 1380 420, 1060 270, 780 330 S 180 420, -120 300 Z"/>
<path class="band b3" fill="url(#g3)" d="M-120 220 C 300 120, 640 330, 980 230 S 1500 180, 1720 260 L 1720 520 C 1400 430, 1100 560, 820 480 S 240 440, -120 540 Z"/>
<g>${stars(140)}</g>
</svg>`

/** One wave line, periodic every 400 units so a -400 shift loops seamlessly. */
function wave(y: number, amp: number): string {
  let d = `M0 ${y} Q100 ${y - amp} 200 ${y}`
  for (let x = 400; x <= 3200; x += 200) d += ` T${x} ${y}`
  return d
}

export const WAVES = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<style>
.bg{fill:#e5e9f0}
.line{fill:none;stroke-linecap:round;animation:flow linear infinite}
.w1{stroke:#5e81ac;stroke-width:2.5;opacity:0.22;animation-duration:26s}
.w2{stroke:#81a1c1;stroke-width:2;opacity:0.2;animation-duration:34s}
.w3{stroke:#88c0d0;stroke-width:1.6;opacity:0.18;animation-duration:43s}
.w4{stroke:#8fbcbb;stroke-width:1.2;opacity:0.16;animation-duration:55s}
.r{animation-direction:reverse}
@keyframes flow{0%{transform:translateX(0)}100%{transform:translateX(-400px)}}
@media (prefers-color-scheme: dark){
.bg{fill:#22262f}
.w1{opacity:0.3}.w2{opacity:0.26}.w3{opacity:0.22}.w4{opacity:0.2}
}
</style>
<rect class="bg" width="1600" height="1000"/>
<path class="line w1" d="${wave(70, 26)}"/>
<path class="line w2 r" d="${wave(120, 20)}"/>
<path class="line w3" d="${wave(170, 16)}"/>
<path class="line w4 r" d="${wave(215, 12)}"/>
<path class="line w3 r" d="${wave(262, 10)}"/>
<path class="line w4" d="${wave(305, 8)}"/>
</svg>`

/** Towers framing the left and right edges, with lit windows and neon bars. */
function towers(): string {
  const rand = seeded(23)
  const lit = ['#00f0ff', '#ff2a6d', '#f3e600', '#c77dff']
  let out = ''
  const spans: [number, number][] = [
    [-20, 300],
    [1300, 1620],
  ]
  for (const [from, to] of spans) {
    let x = from
    while (x < to) {
      const w = 40 + Math.round(rand() * 60)
      const h = 380 + Math.round(rand() * 520)
      const top = 1000 - h
      out += `<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="#0d0a1a"/>`
      out += `<rect x="${x}" y="${top}" width="${w}" height="2" fill="#2a1f4a"/>`
      // windows
      for (let wy = top + 14; wy < 990; wy += 18) {
        for (let wx = x + 6; wx < x + w - 8; wx += 12) {
          if (rand() < 0.22) {
            const color = lit[Math.floor(rand() * lit.length)] ?? '#00f0ff'
            out += `<rect x="${wx}" y="${wy}" width="5" height="7" fill="${color}" opacity="${(0.25 + rand() * 0.35).toFixed(2)}"/>`
          }
        }
      }
      // a neon bar on some towers, flickering on a slow, uneven beat
      if (rand() < 0.5) {
        const color = lit[Math.floor(rand() * 2)] ?? '#ff2a6d'
        const cls = `f${Math.floor(rand() * 3)}`
        out += `<rect class="neon ${cls}" x="${x + w / 2 - 3}" y="${top + 30}" width="6" height="${80 + Math.round(rand() * 120)}" fill="${color}" opacity="0.85"/>`
      }
      x += w + Math.round(rand() * 14)
    }
  }
  return out
}

function rain(count: number): string {
  const rand = seeded(91)
  let out = ''
  for (let i = 0; i < count; i++) {
    const x = Math.round(rand() * 1700) - 50
    const y = Math.round(rand() * 1000)
    const len = 14 + Math.round(rand() * 18)
    const cls = `r${i % 3}`
    out += `<line class="drop ${cls}" x1="${x}" y1="${y}" x2="${x - 4}" y2="${y + len}"/>`
  }
  return out
}

export const NEON_CITY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="night" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#07050f"/>
<stop offset="0.6" stop-color="#120a24"/>
<stop offset="1" stop-color="#1a0b2e"/>
</linearGradient>
<radialGradient id="haze" cx="0.5" cy="0.05" r="0.7">
<stop offset="0" stop-color="#ff2a6d" stop-opacity="0.16"/>
<stop offset="0.5" stop-color="#7b2cbf" stop-opacity="0.07"/>
<stop offset="1" stop-color="#000000" stop-opacity="0"/>
</radialGradient>
</defs>
<style>
.neon{animation:flicker 9s steps(1, end) infinite}
.f1{animation-duration:13s;animation-delay:-4s}
.f2{animation-duration:17s;animation-delay:-9s}
@keyframes flicker{0%{opacity:0.85}92%{opacity:0.85}93%{opacity:0.35}95%{opacity:0.85}100%{opacity:0.85}}
.drop{stroke:#9fd8ff;stroke-width:1;opacity:0.1;animation:fall 3.2s linear infinite}
.r1{animation-duration:3.8s;animation-delay:-1.2s}
.r2{animation-duration:4.4s;animation-delay:-2.6s}
@keyframes fall{0%{transform:translate(0,-60px)}100%{transform:translate(-14px,60px)}}
</style>
<rect width="1600" height="1000" fill="url(#night)"/>
<rect width="1600" height="1000" fill="url(#haze)"/>
<g>${rain(90)}</g>
<g>${towers()}</g>
</svg>`

export const SCENES: Record<string, { source: string; alt: string }> = {
  'neon-city': { source: NEON_CITY, alt: 'A rain-soaked neon city at night, towers glowing at the edges' },
  aurora: { source: AURORA, alt: 'A slow aurora drifting over a starry night sky' },
  waves: { source: WAVES, alt: 'Calm wave lines drifting across a cool slate sky' },
}

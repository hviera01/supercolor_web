// Escenas ilustradas para ver dos colores juntos: el principal va en las
// paredes grandes y el de acento en una pared, marcos y detalles.

let contador = 0;

export function escenaSala(principal: string, acento: string): string {
  const id = `s${++contador}`;
  return `
<svg viewBox="0 0 400 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sala con paredes en el color principal y una pared de acento">
  <defs>
    <linearGradient id="${id}-izq" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.08"/>
    </linearGradient>
    <linearGradient id="${id}-der" x1="1" x2="0" y1="0" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.04"/>
    </linearGradient>
    <radialGradient id="${id}-luz" cx="0.62" cy="0.3" r="0.75">
      <stop offset="0" stop-color="#fff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.1"/>
    </radialGradient>
    <linearGradient id="${id}-piso" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#9c7350"/>
      <stop offset="1" stop-color="#c49a6c"/>
    </linearGradient>
    <linearGradient id="${id}-cielo" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#cfe4f2"/>
      <stop offset="1" stop-color="#f3efe2"/>
    </linearGradient>
  </defs>
  <polygon points="0,0 400,0 318,46 82,46" fill="#f6f3ee"/>
  <polygon points="0,0 400,0 318,46 82,46" fill="#000" fill-opacity="0.05"/>
  <rect x="82" y="46" width="236" height="148" fill="${principal}"/>
  <rect x="82" y="46" width="236" height="148" fill="url(#${id}-luz)"/>
  <polygon points="0,0 82,46 82,194 0,260" fill="${acento}"/>
  <polygon points="0,0 82,46 82,194 0,260" fill="url(#${id}-izq)"/>
  <polygon points="400,0 318,46 318,194 400,260" fill="${principal}"/>
  <polygon points="400,0 318,46 318,194 400,260" fill="url(#${id}-der)"/>
  <polygon points="0,260 82,194 318,194 400,260" fill="url(#${id}-piso)"/>
  <g stroke="#7d5a3c" stroke-opacity="0.35" stroke-width="1">
    <line x1="120" y1="194" x2="70" y2="260"/><line x1="160" y1="194" x2="140" y2="260"/>
    <line x1="200" y1="194" x2="200" y2="260"/><line x1="240" y1="194" x2="260" y2="260"/>
    <line x1="280" y1="194" x2="330" y2="260"/>
  </g>
  <rect x="82" y="189" width="236" height="5" fill="#f4f0e8"/>
  <polygon points="0,253 82,189 82,194 0,260" fill="#e9e3d8"/>
  <polygon points="400,253 318,189 318,194 400,260" fill="#e9e3d8"/>
  <g>
    <polygon points="338,70 378,48 378,170 338,180" fill="url(#${id}-cielo)"/>
    <polygon points="338,70 378,48 378,170 338,180" fill="none" stroke="#f7f4ee" stroke-width="5"/>
    <line x1="358" y1="60" x2="358" y2="175" stroke="#f7f4ee" stroke-width="3"/>
  </g>
  <rect x="160" y="78" width="80" height="54" rx="2" fill="#f7f4ee"/>
  <rect x="166" y="84" width="68" height="42" fill="${acento}"/>
  <rect x="166" y="84" width="68" height="42" fill="#000" fill-opacity="0.12"/>
  <path d="M166 120 L190 100 L206 112 L220 98 L234 110 L234 126 L166 126 Z" fill="#fff" fill-opacity="0.35"/>
  <ellipse cx="200" cy="232" rx="78" ry="9" fill="#000" fill-opacity="0.12"/>
  <rect x="128" y="160" width="144" height="30" rx="8" fill="#d9d3c9"/>
  <rect x="120" y="142" width="160" height="26" rx="10" fill="#e6e0d6"/>
  <rect x="112" y="152" width="22" height="48" rx="8" fill="#d4cdc2"/>
  <rect x="266" y="152" width="22" height="48" rx="8" fill="#d4cdc2"/>
  <rect x="122" y="178" width="156" height="26" rx="6" fill="#cfc8bc"/>
  <rect x="140" y="150" width="34" height="24" rx="6" fill="${acento}"/>
  <rect x="140" y="150" width="34" height="24" rx="6" fill="#000" fill-opacity="0.1"/>
  <rect x="226" y="150" width="34" height="24" rx="6" fill="#f2ede4"/>
  <rect x="128" y="204" width="6" height="12" fill="#6b5442"/>
  <rect x="266" y="204" width="6" height="12" fill="#6b5442"/>
  <rect x="300" y="186" width="20" height="22" rx="3" fill="#b5835a"/>
  <path d="M310 186 C300 170 292 160 296 146 C304 156 308 166 310 186 Z" fill="#4f7a55"/>
  <path d="M310 186 C316 166 326 154 334 150 C330 166 320 176 310 186 Z" fill="#5f8c63"/>
  <path d="M310 186 C308 168 310 150 316 138 C320 154 316 170 310 186 Z" fill="#456d4b"/>
  <line x1="98" y1="214" x2="98" y2="120" stroke="#3a3632" stroke-width="2.5"/>
  <path d="M86 122 L110 122 L104 104 L92 104 Z" fill="#f3ead8"/>
  <ellipse cx="98" cy="215" rx="10" ry="3" fill="#3a3632"/>
</svg>`;
}

export function escenaFachada(principal: string, acento: string): string {
  const id = `f${++contador}`;
  return `
<svg viewBox="0 0 400 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Fachada con muros en el color principal y detalles en el de acento">
  <defs>
    <linearGradient id="${id}-cielo" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#bcd9ee"/>
      <stop offset="1" stop-color="#eef3f2"/>
    </linearGradient>
    <linearGradient id="${id}-alero" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${id}-sol" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.08"/>
    </linearGradient>
    <pattern id="${id}-teja" width="14" height="10" patternUnits="userSpaceOnUse">
      <rect width="14" height="10" fill="#b4603f"/>
      <path d="M0 10 Q7 2 14 10" fill="none" stroke="#8e4730" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="400" height="260" fill="url(#${id}-cielo)"/>
  <rect x="0" y="226" width="400" height="34" fill="#c9bfb1"/>
  <rect x="0" y="226" width="400" height="4" fill="#a99c8b"/>
  <rect x="26" y="64" width="348" height="164" fill="${principal}"/>
  <rect x="26" y="64" width="348" height="164" fill="url(#${id}-sol)"/>
  <polygon points="12,66 388,66 372,40 28,40" fill="url(#${id}-teja)"/>
  <rect x="10" y="64" width="380" height="5" fill="#7a3f2b"/>
  <rect x="26" y="69" width="348" height="24" fill="url(#${id}-alero)"/>
  <rect x="26" y="200" width="348" height="28" fill="${acento}"/>
  <rect x="26" y="200" width="348" height="28" fill="#000" fill-opacity="0.08"/>
  <rect x="26" y="69" width="12" height="159" fill="${acento}"/>
  <rect x="362" y="69" width="12" height="159" fill="${acento}"/>
  <rect x="362" y="69" width="12" height="159" fill="#000" fill-opacity="0.1"/>
  <g>
    <path d="M160 228 L160 128 Q200 100 240 128 L240 228 Z" fill="${acento}"/>
    <path d="M170 228 L170 132 Q200 112 230 132 L230 228 Z" fill="#7a4e2e"/>
    <line x1="200" y1="118" x2="200" y2="228" stroke="#5c3a22" stroke-width="2"/>
    <rect x="176" y="150" width="18" height="30" fill="#000" fill-opacity="0.12"/>
    <rect x="206" y="150" width="18" height="30" fill="#000" fill-opacity="0.12"/>
    <rect x="176" y="188" width="18" height="30" fill="#000" fill-opacity="0.12"/>
    <rect x="206" y="188" width="18" height="30" fill="#000" fill-opacity="0.12"/>
    <circle cx="194" cy="176" r="2" fill="#d8b46a"/>
    <circle cx="206" cy="176" r="2" fill="#d8b46a"/>
  </g>
  ${ventanaFachada(64, acento)}
  ${ventanaFachada(276, acento)}
  <path d="M120 98 Q128 88 136 98" fill="none" stroke="#3a3632" stroke-width="2"/>
  <rect x="124" y="98" width="8" height="12" fill="#f3e7c4" stroke="#3a3632" stroke-width="1"/>
  <path d="M264 98 Q272 88 280 98" fill="none" stroke="#3a3632" stroke-width="2"/>
  <rect x="268" y="98" width="8" height="12" fill="#f3e7c4" stroke="#3a3632" stroke-width="1"/>
  <rect x="44" y="206" width="22" height="20" rx="2" fill="#a0603c"/>
  <circle cx="50" cy="200" r="9" fill="#4f7a55"/><circle cx="60" cy="198" r="8" fill="#5f8c63"/><circle cx="55" cy="192" r="7" fill="#456d4b"/>
  <rect x="334" y="206" width="22" height="20" rx="2" fill="#a0603c"/>
  <circle cx="340" cy="200" r="9" fill="#4f7a55"/><circle cx="350" cy="198" r="8" fill="#5f8c63"/><circle cx="345" cy="192" r="7" fill="#456d4b"/>
</svg>`;
}

function ventanaFachada(x: number, acento: string): string {
  return `
  <g>
    <rect x="${x - 6}" y="104" width="72" height="86" fill="${acento}"/>
    <rect x="${x - 10}" y="186" width="80" height="7" fill="${acento}"/>
    <rect x="${x - 10}" y="186" width="80" height="7" fill="#000" fill-opacity="0.14"/>
    <rect x="${x}" y="110" width="60" height="74" fill="#2f3a40"/>
    <rect x="${x}" y="110" width="60" height="74" fill="#9fc3d8" fill-opacity="0.35"/>
    <g stroke="#1f1f1f" stroke-width="2">
      ${[12, 24, 36, 48].map((d) => `<line x1="${x + d}" y1="110" x2="${x + d}" y2="184"/>`).join("")}
      <line x1="${x}" y1="147" x2="${x + 60}" y2="147"/>
    </g>
  </g>`;
}

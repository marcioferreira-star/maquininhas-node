// Icon ÚNICO da Torre V2 (DESIGN_SYSTEM §6) — Tabler Icons inline, stroke=currentColor.
// Substitui as 4 implementações locais triplicadas (Sidebar/Demandas/Resumo/Pesquisar).
// SÓ apresentação: o dicionário é a UNIÃO de todos os ícones usados nas 4 telas (dedup por nome;
// nomes repetidos tinham paths IDÊNTICOS — zero conflito de path).
import * as React from "react";

// dicionário nome → paths (viewBox 0 0 24 24). NENHUM ícone usado hoje pode sumir.
export const ICONS: Record<string, string[]> = {
  // navegação / sidebar
  resumo: ["M4 4h6v6h-6z", "M14 4h6v6h-6z", "M14 14h6v6h-6z", "M4 14h6v6h-6z"],
  demandas: ["M9 6l11 0", "M9 12l11 0", "M9 18l11 0", "M5 6l0 .01", "M5 12l0 .01", "M5 18l0 .01"],
  pesquisar: ["M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "M21 21l-6 -6"],
  implantacao: ["M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z", "M16 3v4", "M8 3v4", "M4 11h16"],
  devolucao: ["M9 14l-4 -4l4 -4", "M5 10h11a4 4 0 1 1 0 8h-1"],
  atendimento: ["M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z", "M3 7l9 6l9 -6"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  chevron: ["M15 6l-6 6l6 6"],
  collapse: ["M11 7l-5 5l5 5", "M17 7l-5 5l5 5"],
  expand: ["M13 7l5 5l-5 5", "M7 7l5 5l-5 5"],
  // comuns
  refresh: ["M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4", "M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"],
  x: ["M18 6l-12 12", "M6 6l12 12"],
  alert: ["M12 9v4", "M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z", "M12 16h.01"],
  check: ["M5 12l5 5l10 -10"],
  checks: ["M7 12l5 5l10 -10", "M2 12l5 5m5 -5l5 -5"], // double-check (Tabler `checks`) — "concluído/pronto" (2ª transição do fluxo LOG)
  send: ["M10 14l11 -11", "M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5"], // Tabler `send` — "Enviado/Retirado" (3ª transição do fluxo LOG)
  info: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M12 8v4", "M12 16h.01"],
  search: ["M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "M21 21l-6 -6"],
  copy: ["M8 8m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z", "M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2"],
  help: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M12 17v.01", "M12 13.5a1.5 1.5 0 0 1 1 -1.5a2.6 2.6 0 1 0 -3 -4"],
  // Atendimento — estados por-máquina (§3.1) + face humana
  upload: ["M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2", "M7 9l5 -5l5 5", "M12 4l0 12"],
  link: ["M9 15l6 -6", "M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464", "M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"],
  "circle-plus": ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M9 12h6", "M12 9v6"],
  user: ["M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0", "M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"],
  mail: ["M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z", "M3 7l9 6l9 -6"],
  "external-link": ["M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6", "M11 13l9 -9", "M15 4h5v5"],
  // Demandas
  truck: ["M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M5 17h-2v-11a1 1 0 0 1 1 -1h9v12m-4 0h6m4 0h2v-6h-8m0 -5h5l3 5"],
  card: ["M3 5m0 3a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z", "M3 10l18 0", "M7 15l.01 0", "M11 15l2 0"],
  filter: ["M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227z"],
  kit: ["M12 3l8 4.5v9l-8 4.5l-8 -4.5v-9z", "M12 12l8 -4.5", "M12 12l0 9", "M12 12l-8 -4.5"],
  clock: ["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0", "M12 7v5l3 3"],
  "chevron-down": ["M6 9l6 6l6 -6"],
  "chevron-up": ["M6 15l6 -6l6 6"],
  "chevron-left": ["M15 6l-6 6l6 6"], // Tabler `chevron-left` — "Trocar evento" (voltar à landing da Implantação)
  pencil: ["M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4", "M13.5 6.5l4 4"],
  // Pesquisar
  eraser: ["M19 20h-10.5l-4.21 -4.3a1 1 0 0 1 0 -1.41l10 -10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3", "M18 13.3l-6.3 -6.3"],
  // Stepper (Implantação/Devolução) — estado bloqueado
  lock: ["M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z", "M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0", "M8 11v-4a4 4 0 1 1 8 0v4"],
  "player-play": ["M7 4v16l13 -8z"], // "Retomar" (Tabler `player-play`) — painel "Em andamento" da Implantação
  // scanner (câmera) — lanterna + zoom
  bulb: ["M3 12h1", "M12 3v1", "M21 12h-1", "M5.6 5.6l.7 .7", "M18.4 5.6l-.7 .7", "M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3", "M9.7 17l4.6 0"],
  "zoom-in": ["M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "M7 10l6 0", "M10 7l0 6", "M21 21l-6 -6"],
  "camera": ["M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2", "M12 16m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"],
};

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 20,
  className,
  strokeWidth = 2,
  color,
  verticalAlign,
}: {
  name: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
  // `color`/`verticalAlign` preservam EXATAMENTE o render das telas que os usavam
  // (Demandas passa color; Demandas+Pesquisar usam verticalAlign:"-0.15em" p/ ícones inline).
  color?: string;
  verticalAlign?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ flexShrink: 0, color, verticalAlign }}
    >
      {(ICONS[name] || []).map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

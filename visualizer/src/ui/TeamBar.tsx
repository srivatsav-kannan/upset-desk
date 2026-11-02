import type { ReactNode } from "react";

/** The team, with LinkedIn and GitHub links. A missing link shows as a dimmed icon until it's filled in. */
const TEAM: { name: string; linkedin?: string; github?: string }[] = [
  { name: "Srivatsav Kannan", linkedin: "https://www.linkedin.com/in/srivatsav-kannan-2bb543200", github: "https://github.com/srivatsav-kannan" },
  { name: "Ray Li", github: "https://github.com/heruirayli" },
  { name: "Krish Wu", github: "https://github.com/KrishWu" },
];

const LinkedIn = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
  </svg>
);

const GitHub = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57v-2.02c-3.34.72-4.04-1.6-4.04-1.6-.55-1.4-1.34-1.77-1.34-1.77-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.31.76-1.6-2.67-.31-5.47-1.34-5.47-5.94 0-1.31.47-2.39 1.24-3.23-.13-.3-.54-1.53.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.65 1.65.24 2.88.12 3.18.77.84 1.23 1.92 1.23 3.23 0 4.61-2.8 5.63-5.48 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.21.7.83.58A12 12 0 0 0 12 .3Z" />
  </svg>
);

function Icon({ href, label, children }: { href?: string; label: string; children: ReactNode }) {
  return href ? (
    <a className="team-icon" href={href} target="_blank" rel="noreferrer" aria-label={label} title={label}>
      {children}
    </a>
  ) : (
    <span className="team-icon team-icon-missing" title={`${label}: coming soon`} aria-hidden="true">
      {children}
    </span>
  );
}

export function TeamBar() {
  return (
    <footer className="team-bar">
      <span className="team-label">Built by</span>
      <ul>
        {TEAM.map((m) => (
          <li key={m.name}>
            <span className="team-name">{m.name}</span>
            <Icon href={m.linkedin} label={`${m.name} on LinkedIn`}>
              <LinkedIn />
            </Icon>
            <Icon href={m.github} label={`${m.name} on GitHub`}>
              <GitHub />
            </Icon>
          </li>
        ))}
      </ul>
      <a className="team-repo" href="https://github.com/srivatsav-kannan/election-prediction" target="_blank" rel="noreferrer">
        Code on GitHub
      </a>
    </footer>
  );
}

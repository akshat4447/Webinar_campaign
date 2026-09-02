'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './ui/Icon';

/** One nav destination. `match` decides highlighting, which is not always
 *  "pathname equals href" — Webinars stays lit while you are inside a
 *  campaign, because a campaign is a webinar. */
interface NavItem {
  href: string;
  label: string;
  icon: 'dashboard' | 'document' | 'template';
  match: (pathname: string) => boolean;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', match: (p) => p === '/dashboard' },
  {
    href: '/',
    label: 'Webinars',
    icon: 'document',
    // A campaign workspace and the wizard both live under Webinars.
    match: (p) => p === '/' || p.startsWith('/campaigns'),
  },
  { href: '/templates', label: 'Templates', icon: 'template', match: (p) => p === '/templates' },
];

function navItemStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 12px',
    borderRadius: 'var(--radius-md)',
    background: active ? 'var(--accent-50)' : 'transparent',
    color: active ? 'var(--accent-700)' : 'var(--n60)',
    textDecoration: 'none',
    fontSize: 'var(--fs-label-1)',
    fontWeight: 'var(--fw-semibold)',
  };
}

export function Sidebar({
  totalCount,
  liveCount,
  draftCount,
  completedCount,
}: {
  totalCount: number;
  liveCount: number;
  draftCount: number;
  completedCount: number;
}) {
  const pathname = usePathname();
  const isIntegrations = pathname === '/integrations';

  return (
    <aside
      style={{
        width: 216,
        flexShrink: 0,
        background: 'var(--surface-card)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        padding: '22px 14px',
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 22px 8px' }}>
        <div style={{ width: 30, height: 30, borderRadius: 7, overflow: 'hidden', flexShrink: 0 }}>
<svg width="30" height="30" viewBox="0 0 88 88" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="87.2732" height="87.2732" fill="#0C9AFC" />
            <path d="M0 43.3984H43.875V87.2735H0V43.3984Z" fill="#172738" />
            <path d="M43.875 43.3984H0L43.875 87.2735V43.3984Z" fill="#F5F5F5" />
            </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-bold)', color: 'var(--n90)', lineHeight: 1.1 }}>
            Webinar Studio
          </div>
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', lineHeight: 1.2 }}>Campaign workspace</div>
        </div>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="lsq-nav"
              data-active={active ? 'true' : 'false'}
              style={navItemStyle(active)}
            >
              <Icon name={item.icon} size={17} style={{ color: active ? 'var(--accent-700)' : 'var(--n60)' }} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Live agent status. Kept from the previous shell: it is the only place
          in the app that answers "is anything running right now?" without
          opening a campaign. */}
      <div
        style={{
          marginTop: 20,
          padding: 14,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--n10)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--success-500)',
              animation: 'lsq-pulse 2s infinite',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 'var(--fs-label-2)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--n80)',
              letterSpacing: '0.03em',
            }}
          >
            AGENT ONLINE
          </span>
        </div>
        <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', lineHeight: 1.5 }}>
          {totalCount} {totalCount === 1 ? 'webinar' : 'webinars'} across {liveCount} live, {draftCount} draft,{' '}
          {completedCount} completed.
        </div>
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 20 }}>
        <Link
          href="/integrations"
          className="lsq-nav"
          data-active={isIntegrations ? 'true' : 'false'}
          style={navItemStyle(isIntegrations)}
        >
          <div
            style={{
              width: 17,
              height: 17,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 3,
              flexShrink: 0,
              color: isIntegrations ? 'var(--accent-700)' : 'var(--n60)',
            }}
          >
            <span style={{ background: 'currentColor', borderRadius: 2 }} />
            <span style={{ background: 'currentColor', borderRadius: 2, opacity: 0.55 }} />
            <span style={{ background: 'currentColor', borderRadius: 2, opacity: 0.55 }} />
            <span style={{ background: 'currentColor', borderRadius: 2 }} />
          </div>
          Integrations
        </Link>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '16px 8px 2px 8px',
            marginTop: 8,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <span
            style={{
              fontSize: 'var(--fs-caption)',
              fontWeight: 'var(--fw-semibold)',
              letterSpacing: '0.08em',
              color: 'var(--n50)',
              textTransform: 'uppercase',
            }}
          >
            Built on
          </span>
<svg width="108" height="19.8" viewBox="0 0 578 106" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 -0.000643553V43.7142H43.5897V88.043H86.7982V-0.000643553H0Z" fill="#0C9AFC" />
          <path d="M100.433 26.8136C96.9467 26.8136 96.9467 21.2945 100.433 21.2945H106.709C107.929 21.2945 108.888 22.2582 108.888 23.3975V82.5238H111.329C114.815 82.5238 114.815 88.043 111.329 88.043H100.869C97.3826 88.043 97.3826 82.5238 100.869 82.5238H103.31V26.8136H100.433" fill="#172738" />
          <path d="M121.353 62.5526H153.08C151.685 53.8804 146.63 47.1358 138.088 47.1358C129.633 47.1358 122.661 54.2309 121.353 62.5526V62.5526ZM139.221 88.4805C125.711 88.4805 115.862 78.0568 115.862 65.1807C115.862 52.5667 125.711 41.6172 138.175 41.6172C150.465 41.6172 158.397 52.0413 158.745 64.7421C158.745 66.3195 157.961 68.0712 156.043 68.0712H121.353C122.748 76.9182 130.244 82.9628 139.134 82.9628C142.272 82.9628 146.978 82.174 149.768 80.7723C151.859 79.7213 153.08 80.5966 153.603 81.5603C154.213 82.7872 153.951 84.4513 152.382 85.3277C148.896 87.3419 143.143 88.4805 139.221 88.4805" fill="#172738" />
          <path d="M182.629 47.5737C173.128 47.5737 165.633 55.545 165.633 65.0926C165.633 74.4658 172.082 82.9628 182.716 82.9628C188.382 83.0496 199.8 78.5825 199.8 65.3558C199.8 56.0707 192.652 47.5737 182.629 47.5737V47.5737ZM201.456 88.0431C200.323 88.0431 199.364 87.0794 199.364 85.9406V80.3342C195.616 85.5902 189.689 88.4805 182.978 88.4805C170.078 88.4805 160.229 77.9692 160.229 65.1807C160.229 52.5667 169.991 42.0553 182.455 42.0553C194.657 42.0553 199.364 51.1649 199.364 51.1649V44.2453C199.364 43.0187 200.323 42.0553 201.456 42.0553H206.075C209.562 42.0553 209.562 47.5737 206.075 47.5737H204.855V82.524H206.075C209.562 82.524 209.562 88.0431 206.075 88.0431H201.456" fill="#172738" />
          <path d="M233.881 47.4861C224.38 47.4861 217.059 55.545 216.884 65.0926C216.71 74.4658 223.334 82.9628 233.968 82.9628C239.633 83.0496 250.616 78.5825 250.616 65.3558C250.616 56.0707 243.904 47.4861 233.881 47.4861V47.4861ZM252.708 88.0431C251.575 88.0431 250.616 87.0794 250.616 85.9406V80.3342C246.868 85.5902 240.941 88.4805 234.229 88.4805C221.33 88.4805 211.48 77.9692 211.48 65.1807C211.48 52.5667 221.242 42.0553 233.706 42.0553C245.909 42.0553 250.616 51.1649 250.616 51.1649V26.7262H249.396C245.909 26.7262 245.909 21.2947 249.396 21.2947H254.015C255.148 21.2947 256.107 22.2584 256.107 23.4852V82.524H257.327C260.814 82.524 260.814 88.0431 257.327 88.0431H252.708" fill="#172738" />
          <path d="M293.325 41.7045C294.633 41.7045 296.027 42.4056 296.027 44.1573V54.4934C295.939 55.8954 294.72 56.8588 293.412 56.8588C291.843 56.8588 290.71 55.8074 290.71 54.3188C290.71 49.0628 285.829 46.5222 280.861 46.5222C276.503 46.5222 271.012 48.9752 271.012 53.8802C271.012 58.2603 275.283 60.4501 283.301 62.377C290.449 64.1287 297.596 65.9686 297.596 74.6407C297.596 83.1378 289.402 88.043 281.907 88.043C277.549 88.043 272.842 86.2905 270.314 83.4002V85.59C270.314 87.3418 268.92 88.043 267.612 88.043C266.305 88.043 264.998 87.3418 264.998 85.59V74.6407C264.998 73.0646 266.392 71.9253 267.787 71.9253C269.53 71.9253 270.75 73.1514 270.75 74.8163C270.75 80.8604 276.59 83.0494 281.82 82.9627C286.352 82.9627 292.192 79.8967 292.192 74.6407C292.192 69.3847 286.352 68.421 282.081 67.4578C270.838 65.0049 265.782 60.9757 265.782 53.8802C265.782 45.9093 273.278 41.617 280.251 41.617C284.696 41.617 288.618 43.5444 290.71 46.1722V44.1573C290.71 42.4056 292.018 41.7045 293.325 41.7045Z" fill="#0C9AFC" />
          <path d="M324.354 47.1356C313.721 47.1356 307.096 55.6322 307.271 65.0049C307.445 74.5532 314.766 82.6121 324.267 82.6121C334.291 82.6121 341.002 74.0275 341.002 64.7419C341.002 51.5153 330.02 47.0481 324.354 47.1356V47.1356ZM347.713 42.0551C351.2 42.0551 351.2 47.5735 347.713 47.5735H346.493V100.569H347.713C351.2 100.569 351.2 106 347.713 106H343.094C341.961 106 341.002 105.036 341.002 103.81V78.9328C341.002 78.9328 336.295 88.043 324.093 88.043C311.629 88.043 301.867 77.5317 301.867 64.9176C301.867 52.1285 311.716 41.617 324.616 41.617C331.327 41.617 337.254 45.0334 341.002 50.2889V44.1573C341.002 43.0185 341.961 42.0551 343.094 42.0551H347.713" fill="#0C9AFC" />
          <path d="M390.511 47.5735C387.024 47.5735 387.024 42.0551 390.511 42.0551H395.653C396.874 42.0551 397.833 43.0185 397.833 44.1573V82.4365H399.924C403.411 82.4365 403.411 88.043 399.924 88.043H394.52C393.3 88.043 392.341 87.0793 392.341 85.8532V80.9472C388.855 86.0281 382.754 88.043 376.914 88.043C363.84 88.043 357.39 79.4584 357.39 67.983V47.5735H355.559C352.073 47.5735 352.073 42.0551 355.559 42.0551H360.702C361.922 42.0551 362.881 43.0185 362.881 44.1573V67.983C362.881 76.3925 367.326 82.5238 376.914 82.5238C385.543 82.5238 392.341 77.6186 392.341 66.9325V47.5735H390.511" fill="#0C9AFC" />
          <path d="M428.166 47.5737C418.665 47.5737 411.169 55.545 411.169 65.0926C411.169 74.4658 417.62 82.9628 428.253 82.9628C433.918 83.0496 445.337 78.5825 445.337 65.3558C445.337 56.0707 438.189 47.5737 428.166 47.5737V47.5737ZM446.993 88.0431C445.859 88.0431 444.901 87.0794 444.901 85.9406V80.3342C441.153 85.5902 435.226 88.4805 428.514 88.4805C415.615 88.4805 405.766 77.9692 405.766 65.1807C405.766 52.5667 415.528 42.0553 427.991 42.0553C440.194 42.0553 444.901 51.1649 444.901 51.1649V44.2453C444.901 43.0187 445.859 42.0553 446.993 42.0553H451.612C455.098 42.0553 455.098 47.5737 451.612 47.5737H450.392V82.524H451.612C455.098 82.524 455.098 88.0431 451.612 88.0431H446.993" fill="#0C9AFC" />
          <path d="M467.65 85.9405C467.65 87.0793 466.692 88.043 465.558 88.043H461.027C457.452 88.043 457.452 82.5238 461.027 82.5238H462.16V47.4859H461.027C457.452 47.4859 457.452 42.0551 461.027 42.0551H465.558C466.692 42.0551 467.65 43.0185 467.65 44.2451V49.8511C471.66 43.8946 477.238 42.0551 483.862 42.0551C485.344 41.9677 486.738 42.8433 486.738 44.6829C486.738 47.4859 483.862 47.4859 483.862 47.4859H483.601C476.541 47.4859 467.65 51.4277 467.65 61.1509V85.9405Z" fill="#0C9AFC" />
          <path d="M490.662 62.5526H522.389C520.995 53.8804 515.94 47.1358 507.397 47.1358C498.943 47.1358 491.97 54.2309 490.662 62.5526V62.5526ZM508.53 88.4805C495.021 88.4805 485.172 78.0568 485.172 65.1807C485.172 52.5667 495.021 41.6172 507.485 41.6172C519.775 41.6172 527.706 52.0413 528.055 64.7421C528.055 66.3195 527.271 68.0712 525.353 68.0712H490.662C492.058 76.9182 499.553 82.9628 508.444 82.9628C511.581 82.9628 516.288 82.174 519.077 80.7723C521.169 79.7213 522.389 80.5966 522.912 81.5603C523.522 82.7872 523.261 84.4513 521.692 85.3277C518.206 87.3419 512.453 88.4805 508.53 88.4805" fill="#0C9AFC" />
          <path d="M551.938 47.4861C542.438 47.4861 535.116 55.545 534.942 65.0926C534.767 74.4658 541.392 82.9628 552.026 82.9628C557.691 83.0496 568.673 78.5825 568.673 65.3558C568.673 56.0707 561.961 47.4861 551.938 47.4861V47.4861ZM570.765 88.0431C569.632 88.0431 568.673 87.0794 568.673 85.9406V80.3342C564.925 85.5902 558.998 88.4805 552.287 88.4805C539.387 88.4805 529.538 77.9692 529.538 65.1807C529.538 52.5667 539.3 42.0553 551.764 42.0553C563.967 42.0553 568.673 51.1649 568.673 51.1649V26.7262H567.453C563.967 26.7262 563.967 21.2947 567.453 21.2947H572.073C573.206 21.2947 574.165 22.2584 574.165 23.4852V82.524H575.384C578.871 82.524 578.871 88.0431 575.384 88.0431H570.765" fill="#0C9AFC" />
          <path d="M43.5897 88.043H0V43.714L43.5897 88.043Z" fill="#172738" />
          </svg>
        </div>
      </div>
    </aside>
  );
}

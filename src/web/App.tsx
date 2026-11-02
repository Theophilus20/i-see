import { useEffect, type ReactNode } from 'react';
import { Link, Route, Router, Switch, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { Icon } from './components/Icon';
import { Logo } from './brand/Logo';
import { AVAILABILITY_TEXT, useHealth } from './lib/health';
import { useSettings } from './lib/settings';
import { setInterfaceLanguage } from './lib/i18n';
import { Home } from './pages/Home';
import { Scan } from './pages/Scan';
import { Darkroom } from './pages/Darkroom';
import { Workspace } from './pages/Workspace';
import { Passport } from './pages/Passport';
import { Compare } from './pages/Compare';
import { Method } from './pages/Method';
import { Privacy } from './pages/Privacy';
import { SettingsPage } from './pages/Settings';
import { Report } from './pages/Report';
import { Train } from './pages/Train';
import { ContributorThanks } from './components/ContributorThanks';

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const [loc] = useLocation();
  const on = href === '/' ? loc === '/' : loc.startsWith(href);
  return (
    <Link href={href} className={`nav-link ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined}>
      {children}
    </Link>
  );
}

function Status() {
  const { state } = useHealth();
  const t = AVAILABILITY_TEXT[state];
  return (
    <Link href="/settings" className={`status status-${state}`} title={t.long}>
      <span className="status-dot" aria-hidden="true" />
      <span>{t.short}</span>
    </Link>
  );
}

/** Keeps the interface in the chosen language. */
function InterfaceLanguage() {
  const language = useSettings((s) => s.language);
  const on = useSettings((s) => s.translateUi);
  const health = useHealth((s) => s.state);
  useEffect(() => {
    setInterfaceLanguage(language, on, health === 'live');
  }, [language, on, health]);
  return null;
}

function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  // The scan in progress has no footer, and follows the chosen appearance like every other page
  // (a dark scan screen in light mode flipped to light the moment the scan finished).
  const immersive = loc.startsWith('/run');
  const darkTop = loc === '/';
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [loc]);
  return (
    <>
      <InterfaceLanguage />
      <ContributorThanks />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={`topbar no-print ${darkTop ? 'surface-dark' : ''}`}>
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <Logo />
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink href="/scan">Examine</NavLink>
            <NavLink href="/passport">Passport</NavLink>
            <NavLink href="/compare">Compare</NavLink>
            <NavLink href="/train">Train</NavLink>
            <NavLink href="/method">How it works</NavLink>
          </nav>
          <div className="topbar-end">
            <Status />
            <Link href="/settings" className="icon-btn" aria-label="Settings">
              <Icon name="settings" />
            </Link>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={immersive ? 'immersive' : undefined}>
        {children}
      </main>
      {!immersive && (
        <footer className="footer no-print">
          <div className="wrap footer-inner">
            <Logo height={22} />
            <p>Photos are re-encoded on your device and never stored on our server. Your Passport stays in this browser.</p>
            <nav aria-label="Footer">
              <Link href="/method">How it works</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/settings">Settings</Link>
            </nav>
          </div>
        </footer>
      )}
    </>
  );
}

export function App() {
  const check = useHealth((s) => s.check);
  useEffect(() => {
    void check();
  }, [check]);
  return (
    <Router hook={useHashLocation}>
      <Shell>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/scan" component={Scan} />
          <Route path="/run" component={Darkroom} />
          <Route path="/p/:id/report" component={Report} />
          <Route path="/p/:id/:tab?" component={Workspace} />
          <Route path="/passport" component={Passport} />
          <Route path="/compare" component={Compare} />
          <Route path="/train" component={Train} />
          <Route path="/method" component={Method} />
          <Route path="/privacy" component={Privacy} />
          <Route path="/settings" component={SettingsPage} />
          <Route>
            <div className="wrap page-pad">
              <h1>Not found</h1>
              <p className="muted">
                That page does not exist. <Link href="/">Go to the start.</Link>
              </p>
            </div>
          </Route>
        </Switch>
      </Shell>
    </Router>
  );
}

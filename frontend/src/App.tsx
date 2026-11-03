import { Architecture } from "./components/Architecture";
import { ShipIt } from "./components/ShipIt";
import { Trace } from "./components/Trace";
import { profile } from "./content";

function Section(props: { id: string; n: string; title: string; lead: string; children: React.ReactNode }) {
  return (
    <section id={props.id} className="section">
      <div className="kicker mono">{props.n}</div>
      <h2>{props.title}</h2>
      <p className="lead">{props.lead}</p>
      {props.children}
    </section>
  );
}

function App() {
  return (
    <>
      <header className="top">
        <span className="mono brand">milanvulin.com</span>
        <nav>
          <a href="#ship">Ship it</a>
          <a href="#architecture">Architecture</a>
          <a href="#trace">Trace</a>
        </nav>
      </header>

      <main className="page">
        <section className="hero">
          <h1>{profile.name}</h1>
          <p className="title">{profile.title}</p>
          <p className="lead">{profile.intro}</p>
          <ul className="chips">
            {profile.skills.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="links">
            {profile.links.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </p>
        </section>

        <Section
          id="ship"
          n="01"
          title="Ship it, live"
          lead="How long this exact version took to get from a push to production, measured from the real build and the real container start."
        >
          <ShipIt />
        </Section>

        <Section
          id="architecture"
          n="02"
          title="Clickable architecture"
          lead="The path a request takes in, and the path code takes out. Select a node for its configuration and what it demonstrates."
        >
          <Architecture />
        </Section>

        <Section
          id="trace"
          n="03"
          title="Trace my request"
          lead="How your own request reached this page, hop by hop, with a round-trip time measured from your browser."
        >
          <Trace />
        </Section>
      </main>

      <footer className="foot">
        <span>
          Source:{" "}
          <a href="https://github.com/vulinm/milanvulin-site">vulinm/milanvulin-site</a>. PolyForm Noncommercial 1.0.0.
        </span>
      </footer>
    </>
  );
}

export default App;
export { App };

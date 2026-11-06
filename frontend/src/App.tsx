import { ThemeToggle } from "./components/ThemeToggle";
import { useCallback, useEffect, useState } from "react";
import { getChatStatus, type ChatStatus } from "./api";
import { Architecture } from "./components/Architecture";
import { Chat } from "./components/Chat";
import { PingCard } from "./components/PingCard";
import { NetworkLab } from "./components/NetworkLab";
import { ShipIt } from "./components/ShipIt";
import { ChatTelemetry, Telemetry } from "./components/Telemetry";
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
  // The chat section only exists when the server has a local model configured.
  const [chat, setChat] = useState<ChatStatus | null>(null);
  const checkChat = useCallback(() => {
    getChatStatus()
      .then(setChat)
      .catch(() => setChat(null));
  }, []);
  useEffect(checkChat, [checkChat]);

  return (
    <>
      <header className="top">
        <span className="mono brand">milanvulin.com</span>
        <nav>
          {chat?.enabled && <a href="#chat">Ask AI</a>}
          <a href="#ship">Ship it</a>
          <a href="#architecture">Architecture</a>
          <a href="#trace">Trace</a>
          <a href="#lab">Network lab</a>
          <ThemeToggle />
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
          <p className="built-on">{profile.builtOn}</p>
        </section>

        {chat?.enabled && (
          <Section
            id="chat"
            n="00"
            title="Ask my AI"
            lead="A small open model running on the RTX 3060 in my home server, not a hosted API. It knows my public profile and how this site is built, and each answer shows how fast the GPU produced it."
          >
            <Chat status={chat} onRecheck={checkChat} />
            <ChatTelemetry />
            <p className="note">It can be wrong. This site does not store your messages.</p>
          </Section>
        )}

        <Section
          id="ship"
          n="01"
          title="Ship it, live"
          lead="How long this exact version took to get from a push to production, measured from the real build and the real container start."
        >
          <ShipIt />
          <PingCard />
          <Telemetry />
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

        <Section
          id="lab"
          n="04"
          title="Network lab"
          lead="Subnet maths the way Azure counts it. Plan how a virtual network's address space splits into subnets, then see the bits behind each one."
        >
          <NetworkLab />
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

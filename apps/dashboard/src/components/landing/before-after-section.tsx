import { BeforeAfterStrip } from "./before-after-strip";

function NotificationMockup({ name, time }: { name: string; time: string }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.08)",
        borderRadius: "0.75rem",
        padding: "0.75rem 1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span style={{ fontSize: "0.8125rem", color: "#EDE8E1" }}>New message from {name}</span>
      <span style={{ fontSize: "0.75rem", color: "#7A736C" }}>{time}</span>
    </div>
  );
}

function ChatSnippet({ messages }: { messages: { sender: string; text: string; time: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      {messages.map((msg, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "0.5rem",
          }}
        >
          <span style={{ fontSize: "0.6875rem", color: "#7A736C", flexShrink: 0 }}>{msg.time}</span>
          <span style={{ fontSize: "0.8125rem", color: "#EDE8E1" }}>
            <span style={{ fontWeight: 600 }}>{msg.sender}:</span> {msg.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function ThreadMockup() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <div
        style={{
          background: "rgba(255,255,255,0.06)",
          borderRadius: "0.5rem",
          padding: "0.5rem 0.75rem",
          fontSize: "0.8125rem",
          color: "#7A736C",
        }}
      >
        <span style={{ fontWeight: 600 }}>You:</span> Here&rsquo;s your quote — $850 for the full
        package.
      </div>
      <div
        style={{
          fontSize: "0.6875rem",
          color: "#5A5550",
          paddingLeft: "0.75rem",
          fontStyle: "italic",
        }}
      >
        6 days ago · no reply
      </div>
    </div>
  );
}

function FollowUpTimeline() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      {[
        { day: "Day 1", text: "Quote sent", color: "#7A736C" },
        { day: "Day 3", text: "Alex followed up", color: "#EDE8E1" },
        { day: "Day 5", text: "James replied — booked", color: "#A07850" },
      ].map(({ day, text, color }) => (
        <div key={day} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#7A736C", width: "3rem" }}>
            {day}
          </span>
          <span style={{ fontSize: "0.8125rem", color }}>{text}</span>
        </div>
      ))}
    </div>
  );
}

function NotificationStack() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      {["Lisa", "Mark", "Priya", "Tom"].map((name) => (
        <div
          key={name}
          style={{
            background: "rgba(255,255,255,0.06)",
            borderRadius: "0.5rem",
            padding: "0.375rem 0.75rem",
            fontSize: "0.75rem",
            color: "#7A736C",
          }}
        >
          New lead: {name}
        </div>
      ))}
    </div>
  );
}

function SaturdaySummary() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      {[
        { name: "Lisa", result: "Booked Mon 9am", color: "#A07850" },
        { name: "Mark", result: "Booked Tue 2pm", color: "#A07850" },
        { name: "Priya", result: "Tagged: not ready yet", color: "#7A736C" },
        { name: "Tom", result: "Filtered: spam", color: "#5A5550" },
      ].map(({ name, result, color }) => (
        <div
          key={name}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.375rem 0.75rem",
            background: "rgba(255,255,255,0.06)",
            borderRadius: "0.5rem",
          }}
        >
          <span style={{ fontSize: "0.8125rem", color: "#EDE8E1" }}>{name}</span>
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color }}>{result}</span>
        </div>
      ))}
    </div>
  );
}

export function BeforeAfterSection() {
  return (
    <section style={{ background: "#1E1C1A", paddingTop: "5rem", paddingBottom: "5rem" }}>
      <div className="page-width">
        <p
          style={{
            fontSize: "clamp(1.4rem, 2.5vw, 1.8rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "#EDE8E1",
            marginBottom: "1rem",
          }}
        >
          What changes when leads get answered in seconds, not hours.
        </p>

        <div
          style={{
            width: "100%",
            height: "1px",
            background: "rgba(255,255,255,0.08)",
            marginBottom: "1rem",
          }}
        />

        <BeforeAfterStrip
          title="The lead you lost"
          before={{
            visual: <NotificationMockup name="Sarah" time="11:47 PM" />,
            copy: "You replied the next morning. She'd already booked elsewhere.",
          }}
          after={{
            visual: (
              <ChatSnippet
                messages={[
                  {
                    sender: "Sarah",
                    text: "Hi, do you have availability this week?",
                    time: "11:47 PM",
                  },
                  {
                    sender: "Alex",
                    text: "Yes! I have Tuesday at 10am or Thursday at 3pm.",
                    time: "11:47 PM",
                  },
                ]}
              />
            ),
            copy: "Alex responded at 11:47 PM, qualified the lead, and booked Tuesday 10am.",
            microDetail: "Responded in 12 sec",
            outcomeTag: "Booked in 90 seconds.",
          }}
        />

        <div
          style={{
            width: "100%",
            height: "1px",
            background: "rgba(255,255,255,0.06)",
          }}
        />

        <BeforeAfterStrip
          title="The follow-up that never happened"
          before={{
            visual: <ThreadMockup />,
            copy: "Interested lead. Quote sent. Then silence.",
          }}
          after={{
            visual: <FollowUpTimeline />,
            copy: "Alex followed up automatically on day 2 and day 5. James replied and booked.",
            microDetail: "Followed up on day 2 and day 5",
            outcomeTag: "Booking recovered.",
          }}
        />

        <div
          style={{
            width: "100%",
            height: "1px",
            background: "rgba(255,255,255,0.06)",
          }}
        />

        <BeforeAfterStrip
          title="The weekend you worked"
          before={{
            visual: <NotificationStack />,
            copy: "You were with family. Your leads were waiting.",
          }}
          after={{
            visual: <SaturdaySummary />,
            copy: "Alex handled all 4: 2 booked, 1 tagged for later, 1 filtered out.",
            microDetail: "4 leads handled on Saturday",
            outcomeTag: "Handled without you.",
          }}
        />
      </div>
    </section>
  );
}

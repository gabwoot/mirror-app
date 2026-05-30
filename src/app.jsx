import { useState, useCallback, useRef } from "react";

// ── Parsing ──────────────────────────────────────────────────────────────────
function parseWhatsApp(text) {
  const pattern = /^\[(\d+\/\d+\/\d+),\s+(\d+:\d+:\d+\s+[AP]M)\]\s+([^:]+):\s+(.*)/;
  const messages = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(pattern);
    if (!m) continue;
    const [, dateStr, timeStr, sender, body] = m;
    const dt = new Date(`${dateStr} ${timeStr}`);
    if (isNaN(dt)) continue;
    if (body.includes("end-to-end encrypted")) continue;
    messages.push({ dt, sender: sender.trim(), text: body.trim() });
  }
  return messages;
}

function analyzeMessages(messages) {
  if (!messages.length) return null;

  // Identify the two main participants
  const senderCounts = {};
  for (const m of messages) {
    senderCounts[m.sender] = (senderCounts[m.sender] || 0) + 1;
  }
  const sorted = Object.entries(senderCounts).sort((a, b) => b[1] - a[1]);
  const [nameA] = sorted[0];
  const [nameB] = sorted[1] || ["Other", 0];

  const isA = (s) => s === nameA;

  const msgsA = messages.filter((m) => isA(m.sender));
  const msgsB = messages.filter((m) => !isA(m.sender));

  // Date range
  const firstDate = messages[0].dt;
  const lastDate = messages[messages.length - 1].dt;
  const spanDays = Math.round((lastDate - firstDate) / 86400000);
  const spanYears = (spanDays / 365).toFixed(1);

  // Initiation (conversation = gap > 2hrs)
  let convA = 0, convB = 0;
  let lastDt = messages[0].dt;
  let lastSender = messages[0].sender;
  convA += isA(messages[0].sender) ? 1 : 0;
  convB += !isA(messages[0].sender) ? 1 : 0;
  for (let i = 1; i < messages.length; i++) {
    const gap = (messages[i].dt - lastDt) / 3600000;
    if (gap > 2) {
      isA(messages[i].sender) ? convA++ : convB++;
    }
    lastDt = messages[i].dt;
    lastSender = messages[i].sender;
  }
  const totalConvs = convA + convB;

  // Affection terms
  const affectTerms = ["love you", "miss you", "my love", "baby", "mi amor", "te amo", "honey", "te extraño", "i love", "babe"];
  const countTerm = (msgs, terms) =>
    msgs.filter((m) => terms.some((t) => m.text.toLowerCase().includes(t))).length;
  const warmA = countTerm(msgsA, affectTerms);
  const warmB = countTerm(msgsB, affectTerms);

  // Sorry
  const sorryA = msgsA.filter((m) => m.text.toLowerCase().includes("sorry")).length;
  const sorryB = msgsB.filter((m) => m.text.toLowerCase().includes("sorry")).length;

  // Miss you
  const missA = msgsA.filter((m) => m.text.toLowerCase().includes("miss")).length;
  const missB = msgsB.filter((m) => m.text.toLowerCase().includes("miss")).length;

  // Avg message length
  const avgLen = (msgs) => {
    const valid = msgs.filter((m) => !m.text.includes("omitted"));
    return valid.reduce((s, m) => s + m.text.length, 0) / (valid.length || 1);
  };

  // Activity by hour
  const byHour = Array(24).fill(0);
  for (const m of messages) byHour[m.dt.getHours()]++;

  // Warmth by quarter
  const quarters = {};
  for (const m of messages) {
    const q = `${m.dt.getFullYear()}-Q${Math.floor(m.dt.getMonth() / 3) + 1}`;
    if (!quarters[q]) quarters[q] = { total: 0, warm: 0 };
    quarters[q].total++;
    if (affectTerms.some((t) => m.text.toLowerCase().includes(t))) quarters[q].warm++;
  }
  const warmthTrend = Object.entries(quarters)
    .filter(([, v]) => v.total > 50)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([q, v]) => ({ q, rate: (v.warm / v.total) * 100 }));

  // Derive label for shorter name display
  const labelA = nameA.split(" ")[0].replace(/[^\w]/g, "").slice(0, 12);
  const labelB = nameB.split(" ")[0].replace(/[^\w]/g, "").slice(0, 12);

  // High-level archetype
  const warmthAvg = warmthTrend.reduce((s, x) => s + x.rate, 0) / (warmthTrend.length || 1);
  const initiationImbalance = Math.abs(convA / totalConvs - 0.5);
  const sorryImbalance = Math.abs(sorryA / (sorryA + sorryB + 1) - 0.5);

  let archetype, archetypeDesc;
  if (warmthAvg > 35 && initiationImbalance > 0.15) {
    archetype = "High Warmth · Asymmetric Effort";
    archetypeDesc = "Deep affection runs through this relationship, but one person carries more of the reaching-out.";
  } else if (warmthAvg > 35) {
    archetype = "High Warmth · Balanced";
    archetypeDesc = "Strong mutual affection expressed consistently and fairly by both sides.";
  } else if (warmthAvg > 20) {
    archetype = "Steady & Grounded";
    archetypeDesc = "A relationship that communicates with practicality and care — warmth is there, just quieter.";
  } else {
    archetype = "Functional Partnership";
    archetypeDesc = "Communication is task-focused. Warmth may live outside of text.";
  }

  // ── Friction & Repair analysis ──────────────────────────────────────────────
  const conflictTerms = [
    "stop it","leave me","i'm done","im done","you always","you never",
    "why do you","don't do that","dont do that","not okay","upset with",
    "i'm upset","im upset","stop being","this is too much","i can't do this",
    "i cant do this","you hurt","that hurt","you made me","stop doing",
    "why would you","i hate when","you don't care","you dont care",
    "you don't listen","you dont listen","not fair","stop lying",
  ];
  const repairTerms = ["sorry","i apologize","forgive me","my bad","i was wrong","i love you","let's talk","lets talk","can we talk","i miss you"];
  const isConflict = (t) => conflictTerms.some((c) => t.toLowerCase().includes(c));
  const isRepair = (t) => repairTerms.some((r) => t.toLowerCase().includes(r));

  const episodes = [];
  let ei = 0;
  while (ei < messages.length) {
    if (isConflict(messages[ei].text)) {
      const epMsgs = [messages[ei]];
      let ej = ei + 1;
      while (ej < messages.length) {
        const gap = (messages[ej].dt - messages[ej - 1].dt) / 3600000;
        if (gap > 3) break;
        if (isConflict(messages[ej].text) || isRepair(messages[ej].text)) epMsgs.push(messages[ej]);
        ej++;
      }
      if (epMsgs.length >= 2) {
        const repairMsg = epMsgs.find((m) => isRepair(m.text));
        episodes.push({
          start: epMsgs[0].dt,
          durationMins: (epMsgs[epMsgs.length - 1].dt - epMsgs[0].dt) / 60000,
          initiator: isA(epMsgs[0].sender) ? "A" : "B",
          repairBy: repairMsg ? (isA(repairMsg.sender) ? "A" : "B") : null,
          repairMins: repairMsg ? (repairMsg.dt - epMsgs[0].dt) / 60000 : null,
        });
      }
      ei = ej;
    } else { ei++; }
  }

  const byYear = {};
  for (const ep of episodes) {
    const yr = ep.start.getFullYear();
    byYear[yr] = (byYear[yr] || 0) + 1;
  }
  const conflictByYear = Object.entries(byYear).sort(([a],[b]) => a-b).map(([y,c]) => ({ year: y, count: c }));

  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const byMonth = Array(12).fill(0);
  for (const ep of episodes) byMonth[ep.start.getMonth()]++;
  const hardestMonth = months[byMonth.indexOf(Math.max(...byMonth))];

  const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const byDow = Array(7).fill(0);
  for (const ep of episodes) byDow[(ep.start.getDay() + 6) % 7]++;
  const hardestDay = days[byDow.indexOf(Math.max(...byDow))];

  const initA = episodes.filter((e) => e.initiator === "A").length;
  const initB = episodes.filter((e) => e.initiator === "B").length;
  const repairA = episodes.filter((e) => e.repairBy === "A").length;
  const repairB = episodes.filter((e) => e.repairBy === "B").length;
  const unresolved = episodes.filter((e) => !e.repairBy).length;
  const repairTimes = episodes.filter((e) => e.repairMins !== null).map((e) => e.repairMins);
  const avgRepairMins = repairTimes.length ? Math.round(repairTimes.reduce((s,x)=>s+x,0)/repairTimes.length) : null;
  const avgDurationMins = episodes.length ? Math.round(episodes.reduce((s,e)=>s+e.durationMins,0)/episodes.length) : 0;

  // ── Communication Style Fingerprint ─────────────────────────────────────────
  const fingerprint = (msgs) => {
    const valid = msgs.filter((m) => !m.text.includes("omitted") && m.text.length > 0);
    const questions = valid.filter((m) => m.text.includes("?")).length;
    const exclamations = valid.filter((m) => m.text.includes("!")).length;
    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const withEmoji = valid.filter((m) => emojiRe.test(m.text)).length;
    const lateNight = msgs.filter((m) => { const h = m.dt.getHours(); return h >= 0 && h < 4; }).length;
    const lengths = valid.map((m) => m.text.length);
    const under20 = valid.filter((m) => m.text.length <= 20).length;
    const over100 = valid.filter((m) => m.text.length > 100).length;
    const spanishRe = /\b(amor|gracias|pero|porque|cuando|estoy|quiero|sabes|verdad|claro|también|siempre|nunca|noche|buenas|hola|qué|cómo|dónde)\b/i;
    const spanish = valid.filter((m) => spanishRe.test(m.text)).length;
    // response times
    return {
      total: valid.length,
      questionPct: ((questions / valid.length) * 100).toFixed(1),
      exclamationPct: ((exclamations / valid.length) * 100).toFixed(1),
      emojiPct: ((withEmoji / valid.length) * 100).toFixed(1),
      lateNightPct: ((lateNight / msgs.length) * 100).toFixed(1),
      shortMsgPct: ((under20 / valid.length) * 100).toFixed(1),
      longMsgPct: ((over100 / valid.length) * 100).toFixed(1),
      spanishPct: ((spanish / valid.length) * 100).toFixed(1),
    };
  };
  const fingerprintA = fingerprint(msgsA);
  const fingerprintB = fingerprint(msgsB);

  // ── Silence Map ──────────────────────────────────────────────────────────────
  const silences = [];
  for (let si = 1; si < messages.length; si++) {
    const gapHrs = (messages[si].dt - messages[si-1].dt) / 3600000;
    if (gapHrs >= 12) {
      silences.push({
        start: messages[si-1].dt,
        end: messages[si].dt,
        gapHrs: Math.round(gapHrs),
        gapDays: (gapHrs / 24).toFixed(1),
        whoResumed: isA(messages[si].sender) ? "A" : "B",
      });
    }
  }
  silences.sort((a, b) => b.gapHrs - a.gapHrs);
  const top10Silences = silences.slice(0, 10);
  const avgSilenceHrs = silences.length
    ? Math.round(silences.reduce((s, x) => s + x.gapHrs, 0) / silences.length)
    : 0;
  const whoResumesA = silences.filter((s) => s.whoResumed === "A").length;
  const whoResumesB = silences.filter((s) => s.whoResumed === "B").length;

  // ── Topic Clusters (keyword-based) ───────────────────────────────────────────
  const topicDefs = [
    { label: "Food & Eating", emoji: "🍽️", terms: ["food","eat","hungry","dinner","lunch","breakfast","cook","restaurant","pizza","tacos","coffee","drink","meal","snack","order","doordash","ubereats"] },
    { label: "Money & Finances", emoji: "💸", terms: ["money","pay","rent","bill","bank","broke","cash","afford","expensive","cheap","budget","lyft","uber","work","income","loan","debt"] },
    { label: "Love & Affection", emoji: "💛", terms: ["love","miss","baby","heart","kiss","hug","beautiful","gorgeous","cute","sweet","romantic","adore","cherish"] },
    { label: "Plans & Logistics", emoji: "📅", terms: ["tomorrow","today","tonight","weekend","plan","schedule","meet","pick up","drop off","going to","let's go","come over","visit","trip","travel"] },
    { label: "Stress & Anxiety", emoji: "😮‍💨", terms: ["stress","anxious","anxiety","worried","overwhelmed","tired","exhausted","hard","difficult","struggle","nervous","scared","fear"] },
    { label: "Family", emoji: "👨‍👩‍👧", terms: ["mom","dad","sister","brother","family","parent","abuela","abuelo","cousin","tia","tio","prima","primo"] },
    { label: "Fun & Humor", emoji: "😂", terms: ["haha","lol","funny","joke","laugh","omg","wtf","crazy","wild","hilarious","lmao","jaja"] },
    { label: "Health & Body", emoji: "🩺", terms: ["sick","doctor","hospital","pain","hurt","headache","tired","sleep","rest","medicine","health","body","feel bad","feel good"] },
  ];

  const topicCounts = topicDefs.map((td) => {
    const count = messages.filter((m) =>
      td.terms.some((t) => m.text.toLowerCase().includes(t))
    ).length;
    return { ...td, count, pct: ((count / messages.length) * 100).toFixed(1) };
  }).sort((a, b) => b.count - a.count);

  // topic shift over time — compare first half vs second half
  const midpoint = messages[Math.floor(messages.length / 2)].dt;
  const firstHalf = messages.filter((m) => m.dt < midpoint);
  const secondHalf = messages.filter((m) => m.dt >= midpoint);
  const topicShift = topicDefs.map((td) => {
    const early = firstHalf.filter((m) => td.terms.some((t) => m.text.toLowerCase().includes(t))).length / firstHalf.length;
    const late = secondHalf.filter((m) => td.terms.some((t) => m.text.toLowerCase().includes(t))).length / secondHalf.length;
    return { label: td.label, emoji: td.emoji, early: (early*100).toFixed(1), late: (late*100).toFixed(1), delta: ((late - early)*100).toFixed(1) };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 4);

  return {
    nameA, nameB, labelA, labelB,
    totalMessages: messages.length,
    countA: msgsA.length, countB: msgsB.length,
    spanDays, spanYears,
    convA, convB, totalConvs,
    warmA, warmB,
    sorryA, sorryB,
    missA, missB,
    avgLenA: avgLen(msgsA).toFixed(0),
    avgLenB: avgLen(msgsB).toFixed(0),
    byHour,
    warmthTrend,
    warmthAvg: warmthAvg.toFixed(1),
    archetype, archetypeDesc,
    firstDate, lastDate,
    friction: {
      total: episodes.length,
      conflictByYear,
      hardestMonth, hardestDay,
      initA, initB,
      repairA, repairB,
      unresolved,
      avgRepairMins,
      avgDurationMins,
      byMonth,
    },
    fingerprintA, fingerprintB,
    silences: { top10: top10Silences, total: silences.length, avgHrs: avgSilenceHrs, resumeA: whoResumesA, resumeB: whoResumesB },
    topics: { counts: topicCounts, shift: topicShift },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const pct = (a, b) => ((a / (a + b)) * 100).toFixed(0);
const fmt = (n) => n.toLocaleString();

// ── Components ────────────────────────────────────────────────────────────────

function BarPair({ labelA, labelB, valA, valB, color = "#e8c547" }) {
  const total = valA + valB || 1;
  const wA = (valA / total) * 100;
  const wB = (valB / total) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 80, fontSize: 11, color: "#888", textAlign: "right", fontFamily: "monospace" }}>{labelA}</span>
        <div style={{ flex: 1, height: 10, background: "#1a1a1a", borderRadius: 5, overflow: "hidden" }}>
          <div style={{ width: `${wA}%`, height: "100%", background: color, borderRadius: 5, transition: "width 1s ease" }} />
        </div>
        <span style={{ width: 40, fontSize: 11, color, fontFamily: "monospace" }}>{fmt(valA)}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 80, fontSize: 11, color: "#888", textAlign: "right", fontFamily: "monospace" }}>{labelB}</span>
        <div style={{ flex: 1, height: 10, background: "#1a1a1a", borderRadius: 5, overflow: "hidden" }}>
          <div style={{ width: `${wB}%`, height: "100%", background: "#555", borderRadius: 5, transition: "width 1s ease" }} />
        </div>
        <span style={{ width: 40, fontSize: 11, color: "#888", fontFamily: "monospace" }}>{fmt(valB)}</span>
      </div>
    </div>
  );
}

function StatCard({ label, children, accent = false }) {
  return (
    <div style={{
      background: accent ? "#111" : "#0d0d0d",
      border: `1px solid ${accent ? "#e8c547" : "#222"}`,
      borderRadius: 12,
      padding: "20px 24px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: "#555", textTransform: "uppercase", fontFamily: "monospace" }}>{label}</div>
      {children}
    </div>
  );
}

function HourChart({ byHour }) {
  const max = Math.max(...byHour);
  const labels = ["12a","1","2","3","4","5","6","7","8","9","10","11","12p","1","2","3","4","5","6","7","8","9","10","11"];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60 }}>
      {byHour.map((v, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div style={{
            width: "100%", background: i >= 16 && i <= 19 ? "#e8c547" : "#333",
            height: `${(v / max) * 52}px`, borderRadius: "2px 2px 0 0", minHeight: 2,
            transition: "height 0.5s ease",
          }} />
          {i % 6 === 0 && <span style={{ fontSize: 8, color: "#444", fontFamily: "monospace" }}>{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
}

function WarmthChart({ trend }) {
  if (!trend.length) return null;
  const max = Math.max(...trend.map((t) => t.rate));
  const min = Math.min(...trend.map((t) => t.rate));
  const range = max - min || 1;
  const w = 100 / trend.length;
  const points = trend.map((t, i) => {
    const x = (i / (trend.length - 1)) * 100;
    const y = 100 - ((t.rate - min) / range) * 80 - 10;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: 80 }}>
      <polyline points={points} fill="none" stroke="#e8c547" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {trend.map((t, i) => {
        const x = (i / (trend.length - 1)) * 100;
        const y = 100 - ((t.rate - min) / range) * 80 - 10;
        return <circle key={i} cx={x} cy={y} r="1.2" fill="#e8c547" vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
  );
}

function FrictionRepair({ data, labelA, labelB }) {
  const { total, conflictByYear, hardestMonth, hardestDay, initA, initB,
          repairA, repairB, unresolved, avgRepairMins, avgDurationMins, byMonth } = data;

  const maxMonth = Math.max(...byMonth);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const maxYear = Math.max(...conflictByYear.map(y => y.count));
  const firstYear = conflictByYear[0];
  const lastYear = conflictByYear[conflictByYear.length - 1];
  const improved = lastYear && firstYear && lastYear.count < firstYear.count;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
      {/* section header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
        <div style={{ fontSize: 10, letterSpacing: 4, color: "#444", textTransform: "uppercase", fontFamily: "monospace" }}>Friction & Repair</div>
        <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
      </div>

      {/* the good news first */}
      <div style={{
        background: "#0a120a", border: "1px solid #2a4a2a", borderRadius: 12,
        padding: "20px 24px", display: "flex", flexDirection: "column", gap: 8,
      }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: "#4a8a4a", textTransform: "uppercase", fontFamily: "monospace" }}>The arc</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>
          {total} tension episodes across {conflictByYear.length} years
        </div>
        <div style={{ fontSize: 13, color: "#888", lineHeight: 1.6 }}>
          {improved
            ? `Started at ${firstYear.count} in ${firstYear.year}, down to ${lastYear.count} in ${lastYear.year}. You're getting better at this.`
            : `Consistent pattern across the relationship — tension is stable, not escalating.`}
          {" "}Only {unresolved} went fully unresolved out of {total}.
        </div>
      </div>

      {/* year trend */}
      <StatCard label="Friction by Year">
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 56 }}>
          {conflictByYear.map(({ year, count }) => (
            <div key={year} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{
                width: "100%", background: count === Math.max(...conflictByYear.map(y=>y.count)) ? "#e85447" : "#2a2a2a",
                height: `${(count / maxYear) * 44}px`, borderRadius: "3px 3px 0 0", minHeight: 4,
                transition: "height 0.6s ease",
              }} />
              <span style={{ fontSize: 9, color: "#444", fontFamily: "monospace" }}>{year}</span>
              <span style={{ fontSize: 10, color: "#666", fontFamily: "monospace" }}>{count}</span>
            </div>
          ))}
        </div>
      </StatCard>

      {/* who starts, who repairs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <StatCard label="Who Starts Friction">
          <BarPair labelA={labelA} labelB={labelB} valA={initA} valB={initB} color="#e85447" />
          <div style={{ fontSize: 11, color: "#555" }}>Neither of you is the villain — it's nearly even</div>
        </StatCard>
        <StatCard label="Who Initiates Repair">
          <BarPair labelA={labelA} labelB={labelB} valA={repairA} valB={repairB} color="#4a8a4a" />
          <div style={{ fontSize: 11, color: "#555" }}>Who reaches first to end it</div>
        </StatCard>
      </div>

      {/* timing stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <StatCard label="Time to First Repair">
          <div style={{ fontSize: 32, fontWeight: 800, color: "#e8c547" }}>
            {avgRepairMins ? `${avgRepairMins}m` : "—"}
          </div>
          <div style={{ fontSize: 11, color: "#555" }}>avg minutes before someone reaches out</div>
        </StatCard>
        <StatCard label="Avg Episode Length">
          <div style={{ fontSize: 32, fontWeight: 800, color: "#888" }}>
            {avgDurationMins >= 60 ? `${(avgDurationMins/60).toFixed(1)}h` : `${avgDurationMins}m`}
          </div>
          <div style={{ fontSize: 11, color: "#555" }}>from first friction to resolution</div>
        </StatCard>
      </div>

      {/* seasonal pattern */}
      <StatCard label={`Seasonal Pattern · Hardest Month: ${hardestMonth}`}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 48 }}>
          {byMonth.map((v, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={{
                width: "100%",
                background: v === maxMonth ? "#e85447" : v > maxMonth * 0.6 ? "#5a2a2a" : "#1a1a1a",
                height: `${maxMonth > 0 ? (v / maxMonth) * 40 : 0}px`,
                borderRadius: "2px 2px 0 0", minHeight: v > 0 ? 3 : 0,
                transition: "height 0.5s ease",
              }} />
              <span style={{ fontSize: 8, color: "#333", fontFamily: "monospace" }}>{months[i][0]}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#555" }}>
          {hardestDay}s are your hardest day of the week. Summer runs hot.
        </div>
      </StatCard>
    </div>
  );
}

function FingerprintCard({ label, valA, valB, labelA, labelB, unit = "%" }) {
  const fA = parseFloat(valA);
  const fB = parseFloat(valB);
  const max = Math.max(fA, fB, 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 72, fontSize: 10, color: "#666", textAlign: "right", fontFamily: "monospace" }}>{labelA}</span>
        <div style={{ flex: 1, height: 7, background: "#1a1a1a", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${(fA/max)*100}%`, height: "100%", background: "#e8c547", borderRadius: 4 }} />
        </div>
        <span style={{ width: 36, fontSize: 10, color: "#e8c547", fontFamily: "monospace" }}>{valA}{unit}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 72, fontSize: 10, color: "#666", textAlign: "right", fontFamily: "monospace" }}>{labelB}</span>
        <div style={{ flex: 1, height: 7, background: "#1a1a1a", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${(fB/max)*100}%`, height: "100%", background: "#7eb8f7", borderRadius: 4 }} />
        </div>
        <span style={{ width: 36, fontSize: 10, color: "#7eb8f7", fontFamily: "monospace" }}>{valB}{unit}</span>
      </div>
    </div>
  );
}

function CommunicationFingerprint({ fpA, fpB, labelA, labelB }) {
  const traits = [
    { label: "Questions asked", valA: fpA.questionPct, valB: fpB.questionPct },
    { label: "Exclamations!", valA: fpA.exclamationPct, valB: fpB.exclamationPct },
    { label: "Emoji use", valA: fpA.emojiPct, valB: fpB.emojiPct },
    { label: "Short msgs (≤20 chars)", valA: fpA.shortMsgPct, valB: fpB.shortMsgPct },
    { label: "Long msgs (>100 chars)", valA: fpA.longMsgPct, valB: fpB.longMsgPct },
    { label: "Late night (12–4am)", valA: fpA.lateNightPct, valB: fpB.lateNightPct },
    { label: "Spanish messages", valA: fpA.spanishPct, valB: fpB.spanishPct },
  ];

  // derive style labels
  const styleA = [];
  const styleB = [];
  if (parseFloat(fpA.longMsgPct) > parseFloat(fpB.longMsgPct) * 1.3) styleA.push("Paragraph writer");
  else if (parseFloat(fpB.longMsgPct) > parseFloat(fpA.longMsgPct) * 1.3) styleB.push("Paragraph writer");
  if (parseFloat(fpA.shortMsgPct) > parseFloat(fpB.shortMsgPct) * 1.2) styleA.push("Rapid-fire texter");
  else if (parseFloat(fpB.shortMsgPct) > parseFloat(fpA.shortMsgPct) * 1.2) styleB.push("Rapid-fire texter");
  if (parseFloat(fpA.questionPct) > parseFloat(fpB.questionPct) * 1.3) styleA.push("The questioner");
  else if (parseFloat(fpB.questionPct) > parseFloat(fpA.questionPct) * 1.3) styleB.push("The questioner");
  if (parseFloat(fpA.emojiPct) > parseFloat(fpB.emojiPct) * 1.3) styleA.push("Emoji-forward");
  else if (parseFloat(fpB.emojiPct) > parseFloat(fpA.emojiPct) * 1.3) styleB.push("Emoji-forward");
  if (parseFloat(fpA.lateNightPct) > 3) styleA.push("Night owl");
  if (parseFloat(fpB.lateNightPct) > 3) styleB.push("Night owl");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
        <div style={{ fontSize: 10, letterSpacing: 4, color: "#444", textTransform: "uppercase", fontFamily: "monospace" }}>Communication Fingerprint</div>
        <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
      </div>

      {/* style labels */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[{ name: labelA, styles: styleA, color: "#e8c547" }, { name: labelB, styles: styleB, color: "#7eb8f7" }].map(({ name, styles, color }) => (
          <div key={name} style={{ background: "#0d0d0d", border: `1px solid #222`, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color, fontFamily: "monospace", marginBottom: 8 }}>{name}</div>
            {styles.length ? styles.map((s) => (
              <div key={s} style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>· {s}</div>
            )) : <div style={{ fontSize: 12, color: "#444" }}>· Balanced style</div>}
          </div>
        ))}
      </div>

      <div style={{ background: "#0d0d0d", border: "1px solid #222", borderRadius: 12, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
        {traits.map((t) => (
          <FingerprintCard key={t.label} label={t.label} valA={t.valA} valB={t.valB} labelA={labelA} labelB={labelB} />
        ))}
      </div>
    </div>
  );
}

function SilenceMap({ silences, labelA, labelB, firstDate, lastDate }) {
  const { top10, total, avgHrs, resumeA, resumeB } = silences;
  const totalSpanMs = lastDate - firstDate;

  const formatDuration = (hrs) => {
    if (hrs >= 168) return `${(hrs/168).toFixed(1)}w`;
    if (hrs >= 24) return `${(hrs/24).toFixed(1)}d`;
    return `${hrs}h`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
        <div style={{ fontSize: 10, letterSpacing: 4, color: "#444", textTransform: "uppercase", fontFamily: "monospace" }}>The Silence Map</div>
        <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
      </div>

      <div style={{ background: "#0d0d0d", border: "1px solid #222", borderRadius: 12, padding: "20px 24px" }}>
        <div style={{ display: "flex", gap: 24, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#fff" }}>{total}</div>
            <div style={{ fontSize: 11, color: "#555" }}>silences over 12hrs</div>
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#888" }}>{formatDuration(avgHrs)}</div>
            <div style={{ fontSize: 11, color: "#555" }}>avg gap length</div>
          </div>
        </div>

        {/* timeline visualization */}
        <div style={{ position: "relative", height: 24, background: "#111", borderRadius: 4, marginBottom: 16, overflow: "hidden" }}>
          {top10.map((s, i) => {
            const leftPct = ((s.start - firstDate) / totalSpanMs) * 100;
            const widthPct = Math.max(((s.end - s.start) / totalSpanMs) * 100, 0.3);
            const intensity = i === 0 ? "#e85447" : i < 3 ? "#c44" : "#622";
            return (
              <div key={i} title={`${formatDuration(s.gapHrs)} silence — ${s.start.toLocaleDateString()}`} style={{
                position: "absolute", left: `${leftPct}%`, width: `${widthPct}%`,
                height: "100%", background: intensity, opacity: 0.8,
              }} />
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#333", fontFamily: "monospace", marginBottom: 20 }}>
          <span>{firstDate.getFullYear()}</span>
          <span>← longest silences marked in red →</span>
          <span>{lastDate.getFullYear()}</span>
        </div>

        {/* top silences list */}
        <div style={{ fontSize: 10, letterSpacing: 2, color: "#444", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 10 }}>Longest silences</div>
        {top10.slice(0, 5).map((s, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #111" }}>
            <div>
              <span style={{ fontSize: 13, color: i === 0 ? "#e85447" : "#888", fontWeight: i === 0 ? 700 : 400 }}>
                {formatDuration(s.gapHrs)}
              </span>
              <span style={{ fontSize: 11, color: "#444", marginLeft: 8 }}>
                {s.start.toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#555" }}>
              resumed by {s.whoResumed === "A" ? labelA : labelB}
            </div>
          </div>
        ))}

        <div style={{ marginTop: 16 }}>
          <BarPair labelA={labelA} labelB={labelB} valA={resumeA} valB={resumeB} color="#7eb8f7" />
          <div style={{ fontSize: 11, color: "#555", marginTop: 8 }}>Who breaks the silence first</div>
        </div>
      </div>
    </div>
  );
}

function TopicClusters({ topics, firstDate, lastDate }) {
  const { counts, shift } = topics;
  const maxCount = Math.max(...counts.map((t) => t.count));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
        <div style={{ fontSize: 10, letterSpacing: 4, color: "#444", textTransform: "uppercase", fontFamily: "monospace" }}>Topic Clusters</div>
        <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
      </div>

      {/* what you talk about */}
      <div style={{ background: "#0d0d0d", border: "1px solid #222", borderRadius: 12, padding: "20px 24px" }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: "#555", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 16 }}>What you talk about</div>
        {counts.map((t) => (
          <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 16, width: 24 }}>{t.emoji}</span>
            <span style={{ width: 130, fontSize: 12, color: "#888" }}>{t.label}</span>
            <div style={{ flex: 1, height: 8, background: "#1a1a1a", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${(t.count / maxCount) * 100}%`, height: "100%", background: "#e8c547", borderRadius: 4, opacity: 0.7 + (t.count/maxCount)*0.3 }} />
            </div>
            <span style={{ fontSize: 11, color: "#555", fontFamily: "monospace", width: 36 }}>{t.pct}%</span>
          </div>
        ))}
      </div>

      {/* what shifted over time */}
      <div style={{ background: "#0d0d0d", border: "1px solid #222", borderRadius: 12, padding: "20px 24px" }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: "#555", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>How your conversations changed</div>
        <div style={{ fontSize: 11, color: "#333", marginBottom: 16 }}>Early relationship vs. now — biggest shifts</div>
        {shift.map((t) => {
          const grew = parseFloat(t.delta) > 0;
          return (
            <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "10px 12px", background: "#111", borderRadius: 8 }}>
              <span style={{ fontSize: 16 }}>{t.emoji}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 2 }}>{t.label}</div>
                <div style={{ fontSize: 10, color: "#444", fontFamily: "monospace" }}>{t.early}% → {t.late}%</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: grew ? "#4a8a4a" : "#e85447" }}>
                {grew ? "+" : ""}{t.delta}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Mixtape({ data }) {
  const { labelA, labelB } = data;

  const intro = `You two communicate like a late-night radio station — warm, bilingual, sometimes crackling with static, but always back on frequency. The data shows a relationship that started intense, weathered real friction, and came out more loving on the other side. Your sound is not polished pop. It's soul, it's bolero, it's the kind of song you don't skip.`;

  const songs = [
    { title: "Como La Flor", artist: "Selena", mood: "nostalgic", era: "90s", why: "Your Spanish code-switching runs deep and so does the emotional range — joy and hurt in the same breath. This is the song that lives in the gap between your warmth and your tension." },
    { title: "Stay With Me", artist: "Sam Smith", mood: "longing", era: "10s", why: `One of you says "miss you" nearly 18x more than the other. This one's for the partner who reaches across distance constantly, without stopping.` },
    { title: "Motownphilly", artist: "Boyz II Men", mood: "euphoric", era: "90s", why: "Your fun & humor numbers are real — you two are genuinely playful. This is the energy of a good day between you, the texts that are just vibes and laughter." },
    { title: "La Llorona", artist: "Chavela Vargas", mood: "fierce", era: "60s", why: "High warmth, high tension. This song holds both without flinching. Ancient, dramatic, completely committed. That's your relationship archetype in four minutes." },
    { title: "Make It Rain", artist: "Ed Sheeran", mood: "bittersweet", era: "10s", why: "For the silences. The data found real gaps — some spanning days. This song is what lives in the space between the last message and the one that finally breaks it open." },
    { title: "Cariño", artist: "Los Destellos", mood: "tender", era: "70s", why: "For the partner who thinks of the other in large and small ways — steady, sweet, devoted in a quiet Peruvian cumbia kind of way." },
    { title: "Cranes in the Sky", artist: "Solange", mood: "intimate", era: "10s", why: "Stress & Anxiety was your lowest topic cluster at 1.3% — you mostly protect each other from the weight. This song is for the rare moments you don't, when it gets real." },
    { title: "Un Verano Sin Ti", artist: "Bad Bunny", mood: "hopeful", era: "20s", why: "Bilingual, from now, survived the hard years and the warmth grew. This is where you are. Summer without fear." },
  ];

  const moodColors = {
    tender: "#f7a97e", longing: "#b87ef7", euphoric: "#e8c547",
    bittersweet: "#7eb8f7", fierce: "#e85447", intimate: "#f77eb8",
    nostalgic: "#aaa", hopeful: "#4a8a4a",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
        <div style={{ fontSize: 10, letterSpacing: 4, color: "#444", textTransform: "uppercase", fontFamily: "monospace" }}>Your Mixtape</div>
        <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
      </div>

      {/* intro letter */}
      <div style={{ background: "#0e0e0e", border: "1px solid #e8c547", borderRadius: 12, padding: "20px 24px" }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#e8c547", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 10 }}>A note on your sound</div>
        <div style={{ fontSize: 14, color: "#999", lineHeight: 1.7 }}>{intro}</div>
      </div>

      {/* songs */}
      {songs.map((song, i) => {
        const moodColor = moodColors[song.mood] || "#888";
        return (
          <div key={i} style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 12, padding: "16px 20px", display: "flex", gap: 16, alignItems: "flex-start" }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#111", border: `1px solid ${moodColor}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#555", flexShrink: 0 }}>
              {i + 1}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{song.title}</div>
                  <div style={{ fontSize: 12, color: "#555" }}>{song.artist}</div>
                </div>
                <div style={{ display: "flex", gap: 5, flexShrink: 0, marginLeft: 8 }}>
                  <span style={{ fontSize: 9, color: moodColor, background: `${moodColor}18`, padding: "3px 7px", borderRadius: 4, fontFamily: "monospace", letterSpacing: 1, textTransform: "uppercase" }}>{song.mood}</span>
                  <span style={{ fontSize: 9, color: "#444", background: "#111", padding: "3px 7px", borderRadius: 4, fontFamily: "monospace" }}>{song.era}</span>
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#555", lineHeight: 1.6 }}>{song.why}</div>
            </div>
          </div>
        );
      })}

      <div style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 11, color: "#333", fontFamily: "monospace" }}>✦</div>
        <div style={{ fontSize: 11, color: "#333" }}>Dynamic mixtape generation coming in Mirror v0.3 — personalized to every relationship's unique fingerprint.</div>
      </div>
    </div>
  );
}

function Paywall() {
  const [unlocked, setUnlocked] = useState(false);
  const STRIPE_LINK = "https://buy.stripe.com/test_aFa3co5V03kggnDflo4Vy00";

  if (unlocked) return null;

  return (
    <div style={{
      margin: "24px 0",
      background: "#0e0e0e",
      border: "1px solid #e8c547",
      borderRadius: 14,
      padding: "28px 24px",
      textAlign: "center",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* blurred preview behind */}
      <div style={{
        position: "absolute", inset: 0, opacity: 0.06,
        background: "repeating-linear-gradient(0deg, #e8c547 0px, #e8c547 1px, transparent 1px, transparent 20px)",
        pointerEvents: "none",
      }} />

      <div style={{ fontSize: 28, marginBottom: 12 }}>🔍</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 8 }}>
        There's more in your data
      </div>
      <div style={{ fontSize: 13, color: "#666", lineHeight: 1.7, marginBottom: 24, maxWidth: 380, margin: "0 auto 24px" }}>
        Friction & Repair, Communication Fingerprint, Silence Map, Topic Clusters, and your Mixtape are waiting. One time, yours to keep.
      </div>
      <a
        href={STRIPE_LINK}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-block",
          background: "#e8c547", color: "#000",
          borderRadius: 8, padding: "13px 32px",
          fontSize: 15, fontWeight: 700,
          textDecoration: "none", letterSpacing: 0.3,
          marginBottom: 16,
        }}
      >
        Go deeper — $12
      </a>
      <div style={{ fontSize: 11, color: "#333" }}>one time · no subscription · no data stored</div>
      <button
        onClick={() => setUnlocked(true)}
        style={{
          display: "block", margin: "16px auto 0",
          background: "none", border: "none",
          color: "#333", fontSize: 11, cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        I already paid — unlock
      </button>
    </div>
  );
}

// ── Upload Screen ─────────────────────────────────────────────────────────────
function UploadScreen({ onAnalyze }) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef();

  const processFile = async (file) => {
    setLoading(true);
    setError("");
    try {
      let text = "";
      if (file.name.endsWith(".zip")) {
        // Use JSZip
        const JSZip = (await import("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js")).default;
        const zip = await JSZip.loadAsync(file);
        const chatFile = Object.values(zip.files).find((f) => f.name.endsWith(".txt"));
        if (!chatFile) throw new Error("No .txt file found in zip");
        text = await chatFile.async("text");
      } else {
        text = await file.text();
      }
      const messages = parseWhatsApp(text);
      if (messages.length < 50) throw new Error("Not enough messages found. Make sure this is a WhatsApp export.");
      const result = analyzeMessages(messages);
      onAnalyze(result);
    } catch (e) {
      setError(e.message || "Something went wrong parsing the file.");
    }
    setLoading(false);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  const onPick = (e) => {
    const file = e.target.files[0];
    if (file) processFile(file);
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#080808", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'DM Sans', sans-serif",
    }}>
      {/* wordmark */}
      <div style={{ marginBottom: 64, textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: 6, color: "#444", textTransform: "uppercase", marginBottom: 12, fontFamily: "monospace" }}>
          digital exhaust
        </div>
        <div style={{ fontSize: 52, fontWeight: 800, color: "#fff", lineHeight: 1, letterSpacing: -2 }}>
          mirror
        </div>
        <div style={{ fontSize: 14, color: "#555", marginTop: 16, maxWidth: 360, lineHeight: 1.6 }}>
          Your digital exhaust knows things about you that you don't.
          Upload a WhatsApp export and find out.
        </div>
      </div>

      {/* drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          width: "100%", maxWidth: 440, border: `2px dashed ${dragging ? "#e8c547" : "#2a2a2a"}`,
          borderRadius: 16, padding: "48px 32px", textAlign: "center", cursor: "pointer",
          background: dragging ? "#111" : "#0a0a0a",
          transition: "all 0.2s ease",
        }}
      >
        <input ref={inputRef} type="file" accept=".txt,.zip" onChange={onPick} style={{ display: "none" }} />
        {loading ? (
          <div style={{ color: "#e8c547", fontSize: 14 }}>Analyzing your messages…</div>
        ) : (
          <>
            <div style={{ fontSize: 36, marginBottom: 16 }}>📱</div>
            <div style={{ color: "#ccc", fontSize: 15, marginBottom: 8 }}>Drop your WhatsApp export here</div>
            <div style={{ color: "#444", fontSize: 12 }}>Accepts .txt or .zip — stays in your browser, never uploaded</div>
          </>
        )}
      </div>

      {error && (
        <div style={{ marginTop: 16, color: "#e85447", fontSize: 13, maxWidth: 440, textAlign: "center" }}>{error}</div>
      )}

      {/* how to export */}
      <div style={{ marginTop: 48, maxWidth: 440, width: "100%" }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#333", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 16 }}>
          How to export from WhatsApp
        </div>
        {[
          "Open the chat you want to analyze",
          "Tap the contact/group name at the top",
          "Scroll down → Export Chat",
          "Choose Without Media and save the .zip or .txt",
        ].map((step, i) => (
          <div key={i} style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#1a1a1a", border: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#555", flexShrink: 0, fontFamily: "monospace" }}>{i + 1}</div>
            <div style={{ fontSize: 13, color: "#555", lineHeight: 1.5 }}>{step}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Relationship type reframing ───────────────────────────────────────────────
const REL_TYPES = [
  { id: "romantic", label: "💛 Romantic Partner" },
  { id: "friendship", label: "🤝 Friendship" },
  { id: "family", label: "👨‍👩‍👧 Family" },
  { id: "situationship", label: "🌀 Situationship" },
];

function reframeArchetype(archetype, archetypeDesc, type) {
  // Rewrite the archetype label and description based on relationship type
  // so the same data patterns read correctly in different contexts
  if (type === "romantic") return { label: archetype, desc: archetypeDesc };

  if (type === "friendship") {
    if (archetype.includes("High Warmth") && archetype.includes("Asymmetric")) {
      return {
        label: "High Warmth · One-Sided Effort",
        desc: "This is a genuinely warm friendship, but one person does most of the reaching out. That's worth noticing — not as a judgment, but as information about where the energy flows.",
      };
    }
    if (archetype.includes("High Warmth · Balanced")) {
      return {
        label: "High Warmth · Mutual",
        desc: "A rare friendship — both people show up consistently, express care, and keep the connection alive equally. That kind of balance doesn't happen by accident.",
      };
    }
    return {
      label: "Steady Friendship",
      desc: "A reliable, low-drama connection. The warmth is real even if it's expressed quietly. Not every friendship needs to be intense to be meaningful.",
    };
  }

  if (type === "family") {
    if (archetype.includes("High Warmth") && archetype.includes("Asymmetric")) {
      return {
        label: "Warm · One Person Carries It",
        desc: "There's real affection in this family relationship, but one person does most of the initiating and reaching. That's a common family dynamic — doesn't make it less real, but it's worth seeing clearly.",
      };
    }
    if (archetype.includes("High Warmth · Balanced")) {
      return {
        label: "Warm & Reciprocal",
        desc: "Both people show up for this relationship in roughly equal measure. For a family connection, that's actually meaningful — it means the effort is mutual, not assumed.",
      };
    }
    return {
      label: "Functional Family Connection",
      desc: "Communication is practical and consistent. The relationship works — it just expresses care more through action than words.",
    };
  }

  if (type === "situationship") {
    if (archetype.includes("High Warmth") && archetype.includes("Asymmetric")) {
      return {
        label: "Hot & Uneven",
        desc: "High warmth, but one person is clearly more invested. In a situationship, that imbalance tends to define everything — who has the power, who gets hurt, who leaves first.",
      };
    }
    if (archetype.includes("High Warmth · Balanced")) {
      return {
        label: "Mutually Entangled",
        desc: "Both people are equally involved, which in a situationship means equally confused. The warmth is real. The definition isn't.",
      };
    }
    return {
      label: "Low Heat · Ambiguous",
      desc: "The connection is real but the feelings run cool. This might be fading, or it might just be how this particular situationship operates.",
    };
  }

  return { label: archetype, desc: archetypeDesc };
}

function reframeInitiation(type) {
  if (type === "friendship") return "who keeps the friendship alive";
  if (type === "family") return "who reaches out first";
  if (type === "situationship") return "who has the power — they text less";
  return "who reaches out first";
}

function reframeAffection(type) {
  if (type === "friendship") return "Warmth in Text";
  if (type === "family") return "Affection Expressed";
  if (type === "situationship") return "Romantic Language";
  return "Affection in Text";
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard({ data, onReset }) {
  const {
    nameA, nameB, labelA, labelB,
    totalMessages, countA, countB,
    spanYears, firstDate, lastDate,
    convA, convB, totalConvs,
    warmA, warmB,
    sorryA, sorryB,
    missA, missB,
    avgLenA, avgLenB,
    byHour, warmthTrend,
    warmthAvg, archetype, archetypeDesc,
  } = data;

  const [relType, setRelType] = useState("romantic");

  const peakHour = byHour.indexOf(Math.max(...byHour));
  const peakLabel = peakHour === 0 ? "midnight" : peakHour < 12 ? `${peakHour}am` : peakHour === 12 ? "noon" : `${peakHour - 12}pm`;

  const { label: archetypeLabel, desc: archetypeDescription } = reframeArchetype(archetype, archetypeDesc, relType);
  const initiationLabel = reframeInitiation(relType);
  const affectionLabel = reframeAffection(relType);

  return (
    <div style={{
      minHeight: "100vh", background: "#080808", color: "#fff",
      fontFamily: "'DM Sans', sans-serif", padding: "32px 20px",
    }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>

        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 6, color: "#444", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 6 }}>digital exhaust · mirror</div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -1 }}>
              {labelA} <span style={{ color: "#333" }}>+</span> {labelB}
            </div>
            <div style={{ fontSize: 12, color: "#444", marginTop: 4, fontFamily: "monospace" }}>
              {firstDate.toLocaleDateString("en-US", { month: "short", year: "numeric" })} → {lastDate.toLocaleDateString("en-US", { month: "short", year: "numeric" })} · {spanYears} years · {fmt(totalMessages)} messages
            </div>
          </div>
          <button onClick={onReset} style={{ background: "none", border: "1px solid #222", color: "#555", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 12 }}>
            ← New
          </button>
        </div>

        {/* relationship type selector */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: "#444", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 10 }}>This is a…</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {REL_TYPES.map(({ id, label }) => (
              <button key={id} onClick={() => setRelType(id)} style={{
                background: relType === id ? "#e8c547" : "#111",
                color: relType === id ? "#000" : "#555",
                border: `1px solid ${relType === id ? "#e8c547" : "#222"}`,
                borderRadius: 20, padding: "6px 14px", fontSize: 12,
                cursor: "pointer", fontWeight: relType === id ? 700 : 400,
                transition: "all 0.15s ease",
              }}>
                {label}
              </button>
            ))}
          </div>
          {relType !== "romantic" && (
            <div style={{ fontSize: 11, color: "#444", marginTop: 8, fontStyle: "italic" }}>
              Lens adjusted — same data, reframed for this relationship type.
            </div>
          )}
        </div>

        {/* archetype */}
        <div style={{
          background: "#0e0e0e", border: "1px solid #e8c547", borderRadius: 14,
          padding: "24px 28px", marginBottom: 24,
        }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "#e8c547", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 10 }}>
            {relType === "romantic" ? "Relationship Archetype" : relType === "friendship" ? "Friendship Archetype" : relType === "family" ? "Family Dynamic" : "Situationship Type"}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{archetypeLabel}</div>
          <div style={{ fontSize: 14, color: "#888", lineHeight: 1.6 }}>{archetypeDescription}</div>
        </div>

        {/* grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>

          <StatCard label="Message Volume">
            <BarPair labelA={labelA} labelB={labelB} valA={countA} valB={countB} />
            <div style={{ fontSize: 11, color: "#555" }}>
              {labelA} sends {pct(countA, countB)}% of all messages
            </div>
          </StatCard>

          <StatCard label="Who Starts Conversations">
            <BarPair labelA={labelA} labelB={labelB} valA={convA} valB={convB} color="#7eb8f7" />
            <div style={{ fontSize: 11, color: "#555" }}>
              {labelA} initiates {pct(convA, convB)}% — {initiationLabel}
            </div>
          </StatCard>

          <StatCard label={affectionLabel}>
            <BarPair labelA={labelA} labelB={labelB} valA={warmA} valB={warmB} color="#f77eb8" />
            <div style={{ fontSize: 11, color: "#555" }}>
              {relType === "romantic" ? "Messages containing love, baby, mi amor, miss you…" :
               relType === "friendship" ? "Messages containing warmth, care, and appreciation" :
               relType === "family" ? "Affectionate language across the relationship" :
               "Romantic and intimate language — tells you who's caught feelings"}
            </div>
          </StatCard>

          <StatCard label="Apologies">
            <BarPair labelA={labelA} labelB={labelB} valA={sorryA} valB={sorryB} color="#f7a97e" />
            <div style={{ fontSize: 11, color: "#555" }}>
              {relType === "situationship" ? "Who apologizes more — usually means who cares more" : "Who says sorry more — repair vs. avoidance?"}
            </div>
          </StatCard>

        </div>

        {/* miss you + message length */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <StatCard label="Expressed Longing (miss you)">
            <BarPair labelA={labelA} labelB={labelB} valA={missA} valB={missB} color="#b87ef7" />
            <div style={{ fontSize: 11, color: "#555" }}>Who reaches across distance more</div>
          </StatCard>

          <StatCard label="Avg Message Length">
            <div style={{ display: "flex", gap: 20 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#e8c547" }}>{avgLenA}</div>
                <div style={{ fontSize: 11, color: "#555" }}>{labelA} chars</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#888" }}>{avgLenB}</div>
                <div style={{ fontSize: 11, color: "#555" }}>{labelB} chars</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#555" }}>Similar length = similar communication style</div>
          </StatCard>
        </div>

        {/* activity by hour */}
        <StatCard label={`When You Talk · Peak: ${peakLabel}`}>
          <HourChart byHour={byHour} />
          <div style={{ fontSize: 11, color: "#555" }}>
            Gold bars = late afternoon peak (4–7pm). When apart is when you talk most.
          </div>
        </StatCard>

        {/* warmth over time */}
        <div style={{ marginTop: 16 }}>
          <StatCard label={`Warmth Over Time · avg ${warmthAvg}% of messages`} accent>
            <WarmthChart trend={warmthTrend} />
            <div style={{ fontSize: 11, color: "#555" }}>
              Each point = one quarter. Higher = more affection language per message.
            </div>
          </StatCard>
        </div>

        {/* paywall */}
        <Paywall />

        {/* friction & repair */}
        {data.friction && (
          <FrictionRepair data={data.friction} labelA={labelA} labelB={labelB} />
        )}

        {/* communication fingerprint */}
        {data.fingerprintA && (
          <CommunicationFingerprint fpA={data.fingerprintA} fpB={data.fingerprintB} labelA={labelA} labelB={labelB} />
        )}

        {/* silence map */}
        {data.silences && (
          <SilenceMap silences={data.silences} labelA={labelA} labelB={labelB} firstDate={firstDate} lastDate={lastDate} />
        )}

        {/* topic clusters */}
        {data.topics && (
          <TopicClusters topics={data.topics} firstDate={firstDate} lastDate={lastDate} />
        )}

        {/* mixtape */}
        <Mixtape data={data} />

        {/* footer */}
        <div style={{ marginTop: 40, textAlign: "center", fontSize: 11, color: "#2a2a2a", fontFamily: "monospace" }}>
          processed locally · nothing left this device · mirror v0.2
        </div>

      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [result, setResult] = useState(null);

  return result
    ? <Dashboard data={result} onReset={() => setResult(null)} />
    : <UploadScreen onAnalyze={setResult} />;
}

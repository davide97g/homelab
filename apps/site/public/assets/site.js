// Small, calm motion: reveal on scroll, step-through flows, the sign-in demo. Nothing else.
(() => {
  const root = document.documentElement;
  root.classList.add("js");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Reveal on scroll.
  const reveal = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        reveal.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  document.querySelectorAll(".reveal").forEach((el) => reveal.observe(el));

  // Runs `tick` every `ms` only while `el` is on screen.
  const whileVisible = (el, ms, tick) => {
    let timer = 0;
    new IntersectionObserver(([e]) => {
      clearInterval(timer);
      if (e.isIntersecting) {
        tick();
        timer = setInterval(tick, ms);
      }
    }, { threshold: 0.35 }).observe(el);
  };

  // Example flows: light the steps one after another, hold at the end, start over.
  document.querySelectorAll("[data-flow]").forEach((flow) => {
    const steps = [...flow.children];
    const bar = flow.parentElement.querySelector(".flow-bar");
    const paint = (i) => {
      steps.forEach((s, j) => {
        s.classList.toggle("is-done", j < i);
        s.classList.toggle("is-on", j === i);
      });
      if (bar) bar.style.setProperty("--fill", `${(i / (steps.length - 1)) * 100}%`);
    };
    if (still) return paint(steps.length - 1);
    let i = -1;
    const hold = 2; // extra ticks on the last step
    whileVisible(flow, 1500, () => {
      i = (i + 1) % (steps.length + hold);
      paint(Math.min(i, steps.length - 1));
    });
  });

  // Accounts: type the email, fill the code, open the apps.
  const acc = document.querySelector("[data-acc]");
  if (acc) {
    const digits = [...acc.querySelectorAll(".acc-code span")];
    let t = 0;
    const frame = () => {
      // 0 empty · 1 typing · 2..7 digits · 8 in · 9-10 hold
      const s = t % 11;
      acc.dataset.step = s === 0 ? "0" : s === 1 ? "1" : s < 8 ? "2" : "3";
      digits.forEach((d, k) => d.classList.toggle("f", s >= 2 && k < s - 1));
      t++;
    };
    if (still) {
      acc.dataset.step = "3";
      digits.forEach((d) => d.classList.add("f"));
    } else {
      whileVisible(acc, 650, frame);
    }

    // A decorative QR-looking pattern (not a real code).
    const qr = acc.querySelector(".qr");
    const N = 21;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const finder = (x, y) => {
      const lx = x - (x < 7 ? 0 : N - 7), ly = y - (y < 7 ? 0 : N - 7);
      return lx === 0 || ly === 0 || lx === 6 || ly === 6 || (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4);
    };
    let cells = "";
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const inFinder = (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7);
        const near = (x < 8 && y < 8) || (x >= N - 8 && y < 8) || (x < 8 && y >= N - 8);
        if (inFinder ? finder(x, y) : !near && rnd() > 0.52) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      }
    }
    qr.innerHTML = cells;
  }
})();

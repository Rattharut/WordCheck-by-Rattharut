(() => {
  const $ = (id) => document.getElementById(id);
  const input = $("input");
  const btn = $("translateBtn");
  const resultCard = $("resultCard");
  const translationText = $("translationText");
  const dictSection = $("dictSection");
  const status = $("status");
  const speakBtn = $("speakBtn");
  const voiceSelect = $("voiceSelect");

  let voices = [];

  function loadVoices() {
    voices = window.speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith("en"));
    voiceSelect.innerHTML = "";
    if (voices.length === 0) {
      const o = document.createElement("option");
      o.textContent = "Default English voice";
      voiceSelect.appendChild(o);
      return;
    }
    // Sort: US, GB, AU first
    const priority = { "en-US": 0, "en-GB": 1, "en-AU": 2, "en-CA": 3, "en-IN": 4 };
    voices.sort((a, b) => (priority[a.lang] ?? 9) - (priority[b.lang] ?? 9));
    voices.forEach((v, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = `${v.name} — ${v.lang}`;
      voiceSelect.appendChild(o);
    });
  }
  
  loadVoices();
  if (typeof speechSynthesis !== "undefined") {
    speechSynthesis.onvoiceschanged = loadVoices;
  }

  function setStatus(html) { 
    status.innerHTML = html ? `<div class="card">${html}</div>` : ""; 
  }

  async function translate(text) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=th&tl=en&dt=t&dt=at&dt=bd&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Network error");
    return res.json();
  }

  function renderResult(data, original) {
    // Primary translation: concatenate all sentence segments [0]
    let primary = "";
    if (Array.isArray(data[0])) {
      data[0].forEach(seg => { if (seg && seg[0]) primary += seg[0]; });
    }
    primary = primary.trim() || "(no translation)";
    translationText.textContent = primary;

    // Dictionary block: data[1] = [[pos, [synonyms...], ...], ...]
    dictSection.innerHTML = "";

    const dict = data[1];
    if (Array.isArray(dict) && dict.length) {
      const title = document.createElement("div");
      title.className = "section-title";
      title.textContent = "Dictionary";
      dictSection.appendChild(title);

      dict.forEach(group => {
        if (!group) return;
        const pos = group[0] || "—";
        const terms = group[1] || [];
        const block = document.createElement("div");
        block.className = "pos-block";
        block.innerHTML = `<div class="pos-tag">${pos}</div>`;
        const chips = document.createElement("div");
        chips.className = "chips";
        terms.forEach(t => {
          const c = document.createElement("span");
          c.className = "chip";
          c.textContent = t;
          chips.appendChild(c);
        });
        block.appendChild(chips);
        dictSection.appendChild(block);
      });
    }

    const alts = data[5];
    if (Array.isArray(alts) && alts.length) {
      const altWords = new Set();
      alts.forEach(a => {
        if (Array.isArray(a) && Array.isArray(a[2])) {
          a[2].forEach(opt => { if (opt && opt[0] && opt[0].toLowerCase() !== primary.toLowerCase()) altWords.add(opt[0]); });
        }
      });
      if (altWords.size) {
        const title = document.createElement("div");
        title.className = "section-title";
        title.textContent = "Synonyms / Alternative translations";
        dictSection.appendChild(title);
        const chips = document.createElement("div");
        chips.className = "chips";
        [...altWords].slice(0, 24).forEach(w => {
          const c = document.createElement("span");
          c.className = "chip";
          c.textContent = w;
          chips.appendChild(c);
        });
        dictSection.appendChild(chips);
      }
    }

    resultCard.style.display = "block";
  }

  async function doTranslate() {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    btn.disabled = true;
    setStatus(`<div class="loading"><span class="spinner"></span>Translating...</div>`);
    resultCard.style.display = "none";
    try {
      const data = await translate(text);
      setStatus("");
      renderResult(data, text);
    } catch (e) {
      setStatus(`<div class="error">⚠️ Couldn't reach the translation service. Please check your connection and try again.</div>`);
    } finally {
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", doTranslate);
  input.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") doTranslate();
  });

  // Text-to-speech
  speakBtn.addEventListener("click", () => {
    const text = translationText.textContent.trim();
    if (!text) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const idx = parseInt(voiceSelect.value, 10);
    if (!Number.isNaN(idx) && voices[idx]) {
      u.voice = voices[idx];
      u.lang = voices[idx].lang;
    } else {
      u.lang = "en-US";
    }
    u.rate = 1; u.pitch = 1;
    u.onstart = () => speakBtn.classList.add("playing");
    u.onend = u.onerror = () => speakBtn.classList.remove("playing");
    synth.speak(u);
  });
})();
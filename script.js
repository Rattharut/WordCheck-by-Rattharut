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

  // มือถือหลายตัว (เบราว์เซอร์ในแอป Line/Facebook, WebView บาง Android) ไม่มี speechSynthesis
  // ถ้าเรียกตรงๆ จะพังทั้งสคริปต์ ปุ่ม Translate เลยไม่ทำงานเลย ต้องเช็กก่อนใช้เสมอ
  const synth = ("speechSynthesis" in window) ? window.speechSynthesis : null;

  function loadVoices() {
    voices = synth ? synth.getVoices().filter(v => v.lang.toLowerCase().startsWith("en")) : [];
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
  
  if (synth) {
    loadVoices();
    synth.onvoiceschanged = loadVoices;
  } else {
    // เครื่องนี้อ่านออกเสียงไม่ได้ ซ่อนปุ่มลำโพงกับช่องเลือกเสียงไปเลย จะได้ไม่กดแล้วเงียบ
    speakBtn.style.display = "none";
    const row = voiceSelect.closest(".voice-row");
    if (row) row.style.display = "none";
  }

  function setStatus(html) { 
    status.innerHTML = html ? `<div class="card">${html}</div>` : ""; 
  }

  // ---------- แหล่งแปล ----------
  // ตัวหลักคือ endpoint ของ Google Translate ตัวที่ไม่เป็นทางการ (client=gtx)
  // ไม่ต้องใช้ API key แต่ Google จำกัดจำนวนคำขอต่อ IP ได้ทุกเมื่อ
  // ถ้าตัวหลักล้ม จะสลับไปใช้ MyMemory ให้อัตโนมัติ เว็บจะได้ไม่ตายทั้งหน้า

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) {
      const err = new Error("HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function describeError(e) {
    if (e && e.status === 429) return "Google is limiting requests from this network";
    if (e && e.status) return "Google replied with HTTP " + e.status;
    return "Google Translate is unreachable from this network";
  }

  // Google มีทางเข้า 2 ทางที่คืนข้อมูลหน้าตาเหมือนกัน
  // ถ้าทางแรกโดนบล็อก (เจอบ่อยบนเน็ตมือถือ เพราะหลายคนใช้ IP ร่วมกันแล้วโดนจำกัดรวม)
  // ให้ลองทางที่สองก่อน ค่อยตกไปใช้ MyMemory เป็นทางสุดท้าย
  const GOOGLE_ENDPOINTS = [
    t => `https://translate.googleapis.com/translate_a/single?client=gtx&sl=th&tl=en&dt=t&dt=at&dt=bd&q=${encodeURIComponent(t)}`,
    t => `https://clients5.google.com/translate_a/single?client=dict-chrome-ex&sl=th&tl=en&dt=t&dt=at&dt=bd&q=${encodeURIComponent(t)}`
  ];

  async function translateGoogleAt(text, buildUrl) {
    const data = await fetchJSON(buildUrl(text));

    let primary = "";
    if (Array.isArray(data[0])) {
      data[0].forEach(seg => { if (seg && seg[0]) primary += seg[0]; });
    }

    const dict = [];
    if (Array.isArray(data[1])) {
      data[1].forEach(g => { if (g) dict.push({ pos: g[0] || "—", terms: g[1] || [] }); });
    }

    const alts = new Set();
    if (Array.isArray(data[5])) {
      data[5].forEach(a => {
        if (Array.isArray(a) && Array.isArray(a[2])) {
          a[2].forEach(opt => { if (opt && opt[0]) alts.add(opt[0]); });
        }
      });
    }

    return { primary: primary.trim(), dict, alts: [...alts], source: "Google Translate" };
  }

  async function translateGoogle(text) {
    let last;
    for (const buildUrl of GOOGLE_ENDPOINTS) {
      try {
        const r = await translateGoogleAt(text, buildUrl);
        if (r.primary) return r;
        last = new Error("empty result");
      } catch (e) {
        last = e;
      }
    }
    throw last || new Error("no endpoint");
  }

  const MYMEMORY_MAX = 500;

  async function translateMyMemory(text) {
    // MyMemory แบบไม่ล็อกอินรับได้ 500 ตัวอักษร ถ้าเกินมันจะไม่แปลให้ กันไว้ก่อนดีกว่ายิงไปเสียเที่ยว
    if (text.length > MYMEMORY_MAX) {
      const e = new Error("too long");
      e.reason = `the backup service only accepts ${MYMEMORY_MAX} characters (you sent ${text.length})`;
      throw e;
    }

    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=th|en`;
    const d = await fetchJSON(url);

    // สำคัญ: MyMemory ตอบ HTTP 200 เสมอ แม้ตอนที่มันพัง
    // ข้อความ error จะถูกยัดมาใน translatedText ถ้าไม่เช็ก จะเอา error ไปโชว์เป็นคำแปล
    const inner = Number(d.responseStatus);
    const raw = ((d.responseData && d.responseData.translatedText) || "").trim();

    if (d.quotaFinished === true || /^MYMEMORY WARNING/i.test(raw)) {
      const e = new Error("quota");
      e.reason = "the backup service has used up its free quota for today";
      throw e;
    }
    if (inner && inner !== 200) {
      const e = new Error("mymemory " + inner);
      e.reason = "the backup service said: " + raw;
      throw e;
    }
    if (!raw) {
      const e = new Error("empty");
      e.reason = "the backup service returned nothing";
      throw e;
    }

    const alts = [...new Set(
      (d.matches || [])
        .map(m => ((m && m.translation) || "").trim())
        .filter(t => t && !/^MYMEMORY WARNING/i.test(t))
    )];

    return { primary: raw, dict: [], alts, source: "MyMemory" };
  }

  async function translate(text) {
    let firstError;
    try {
      return await translateGoogle(text);
    } catch (e) {
      firstError = e;
    }

    try {
      const r = await translateMyMemory(text);
      r.note = describeError(firstError);
      return r;
    } catch (e2) {
      const err = new Error("both sources failed");
      err.reason = describeError(firstError) + ", and " + (e2.reason || "the backup service failed too");
      throw err;
    }
  }

  // ---------- แสดงผล ----------
  function chipRow(words) {
    const chips = document.createElement("div");
    chips.className = "chips";
    words.forEach(w => {
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = w;
      chips.appendChild(c);
    });
    return chips;
  }

  function sectionTitle(text) {
    const t = document.createElement("div");
    t.className = "section-title";
    t.textContent = text;
    return t;
  }

  function renderResult(r) {
    translationText.textContent = r.primary || "(no translation)";
    dictSection.innerHTML = "";

    if (r.dict.length) {
      dictSection.appendChild(sectionTitle("Dictionary"));
      r.dict.forEach(group => {
        const block = document.createElement("div");
        block.className = "pos-block";
        const tag = document.createElement("div");
        tag.className = "pos-tag";
        tag.textContent = group.pos;
        block.appendChild(tag);
        block.appendChild(chipRow(group.terms));
        dictSection.appendChild(block);
      });
    }

    const primaryLower = (r.primary || "").toLowerCase();
    const alts = r.alts.filter(w => w.toLowerCase() !== primaryLower).slice(0, 24);
    if (alts.length) {
      dictSection.appendChild(sectionTitle("Synonyms / Alternative translations"));
      dictSection.appendChild(chipRow(alts));
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
      const r = await translate(text);
      // แปลสำเร็จแล้ว แค่มาจากแหล่งสำรอง เลยใช้กล่องแจ้งเตือนธรรมดา ไม่ใช่สีแดงแบบ error
      setStatus(r.note
        ? `<div class="notice">Translated with ${r.source} — ${r.note}.</div>`
        : "");
      renderResult(r);
    } catch (e) {
      setStatus(`<div class="error">⚠️ Translation failed — ${e.reason || describeError(e)}. Try again in a moment.</div>`);
    } finally {
      btn.disabled = false;
    }
  }

  input.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") doTranslate();
  });

  btn.addEventListener("click", doTranslate);
  // Text-to-speech
  speakBtn.addEventListener("click", () => {
    const text = translationText.textContent.trim();
    if (!text || !synth) return;
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
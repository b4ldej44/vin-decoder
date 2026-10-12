// VIN-декодер: всё считается в браузере. Из VIN берём то, что в нём реально
// закодировано (производитель, серия/модель, год, завод, контрольная цифра),
// дополняем открытым справочником NHTSA и переводим коды опций по codes.js.
(() => {
  const D = window.VIN_DATA;
  const BRAND = { bmw: "BMW", mb: "Mercedes-Benz", audi: "Audi" };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------------------------------------------------------------- VIN

  const TRANSLIT = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5,
                     P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
  const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  const YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";

  function checkDigit(vin) {
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      const c = vin[i];
      sum += (/\d/.test(c) ? +c : TRANSLIT[c]) * WEIGHTS[i];
    }
    const r = sum % 11;
    return r === 10 ? "X" : String(r);
  }

  // Код года повторяется каждые 30 лет: берём самый поздний вариант, который
  // не позже следующего модельного года.
  function modelYear(c) {
    const i = YEAR_CODES.indexOf(c);
    if (i < 0) return null;
    const max = new Date().getFullYear() + 1;
    let y = 1980 + i;
    while (y + 30 <= max) y += 30;
    return y;
  }

  function validate(vin) {
    if (!vin) return "Введите VIN.";
    if (/[IOQ]/.test(vin)) return "В VIN не бывает букв I, O и Q — проверьте, нет ли там цифр 1 и 0.";
    if (/[^A-Z0-9]/.test(vin)) return "VIN состоит только из латинских букв и цифр.";
    if (vin.length !== 17) return `В VIN 17 символов, а введено ${vin.length}.`;
    return null;
  }

  function decode(vin) {
    const wmi = vin.slice(0, 3);
    const [brand, maker, country] = D.wmi[wmi] || [];
    const cd = checkDigit(vin);
    const cdOk = vin[8] === cd;
    const rows = [];
    const notes = [];

    rows.push(["Марка", brand ? BRAND[brand] : '<span class="bad">не BMW, Mercedes-Benz или Audi</span>']);
    if (maker) rows.push(["Производитель (WMI " + wmi + ")", `${esc(maker)}, ${esc(country)}`]);
    else rows.push(["WMI", `<span class="mono">${wmi}</span> — нет в справочнике`]);

    // Год: BMW и Audi кодируют его в 10-й позиции всегда, Mercedes — только в
    // VIN по американскому стандарту. Европейский VIN Mercedes узнаём по
    // шестизначному коду модели в позициях 4–9.
    const mbEurope = brand === "mb" && /^\d{6}$/.test(vin.slice(3, 9));
    const yearKnown = brand === "bmw" || brand === "audi" || (brand === "mb" && !mbEurope && cdOk);
    if (yearKnown) {
      const y = modelYear(vin[9]);
      rows.push(["Модельный год", y ? String(y) : `код «${vin[9]}» не распознан`]);
    } else if (brand === "mb") {
      notes.push("В европейских VIN Mercedes-Benz год выпуска не кодируется — он есть в карте данных или в ПТС.");
    }

    if (brand === "mb") {
      const s = vin.slice(3, 6);
      if (mbEurope) {
        rows.push(["Серия", D.mbSeries[s] ? esc(D.mbSeries[s]) : `${s} — нет в справочнике`]);
        rows.push(["Код модели", `<span class="mono">${s}.${vin.slice(6, 9)}</span>`]);
      }
      rows.push(["Код завода", `<span class="mono">${vin[10]}</span>`]);
    }

    if (brand === "audi") {
      const m = vin.slice(6, 8);
      rows.push(["Модель", D.audiModel[m] ? esc(D.audiModel[m]) : `код ${m} — нет в справочнике`]);
      const p = D.audiPlant[vin[10]];
      rows.push(["Завод", p ? `${esc(p)} <span class="mono">(${vin[10]})</span>` : `<span class="mono">${vin[10]}</span>`]);
    }

    if (brand === "bmw") {
      rows.push(["Типовой код", `<span class="mono">${vin.slice(3, 7)}</span>`]);
      rows.push(["Код завода", `<span class="mono">${vin[10]}</span>`]);
      rows.push(["Короткий VIN", `<span class="mono">${vin.slice(10)}</span> — по нему ищут в каталогах BMW`]);
    }

    rows.push(["Серийный номер", `<span class="mono">${vin.slice(11)}</span>`]);
    // 9-я позиция обязательна как контрольная только в Северной Америке;
    // в европейских VIN там часто буква-заполнитель (у Audi — Z).
    if (!/[0-9X]/.test(vin[8])) {
      rows.push(["Контрольная цифра", "не используется (европейский VIN)"]);
    } else if (cdOk) {
      rows.push(["Контрольная цифра", '<span class="ok">сходится</span>']);
    } else {
      rows.push(["Контрольная цифра", `<span class="warn">не сходится</span> (по расчёту ${cd})`]);
      if (brand !== "mb") notes.push("Контрольная цифра не сходится. Для VIN европейского рынка это допустимо, для американского — признак опечатки.");
    }

    return { brand, rows, notes };
  }

  function strip(vin) {
    const group = (i) => (i < 3 ? "g1" : i < 9 ? "g2" : "g3");
    return '<div class="vinpos">' + [...vin].map((c, i) =>
      `<span class="${group(i)}">${c}<small>${i + 1}</small></span>`).join("") + "</div>";
  }

  // ---------------------------------------------------------------- NHTSA

  const NHTSA_FIELDS = [
    ["Make", "Марка"], ["Model", "Модель"], ["ModelYear", "Модельный год"], ["Series", "Серия"],
    ["Trim", "Исполнение"], ["BodyClass", "Кузов"], ["Doors", "Двери"], ["DriveType", "Привод"],
    ["EngineModel", "Двигатель"], ["DisplacementL", "Объём, л"], ["EngineCylinders", "Цилиндры"],
    ["EngineHP", "Мощность, л.с."], ["FuelTypePrimary", "Топливо"], ["TransmissionStyle", "Коробка"],
    ["PlantCity", "Завод, город"], ["PlantCountry", "Завод, страна"],
  ];
  let nhtsaReq = 0;

  async function loadNhtsa(vin) {
    const box = $("nhtsa");
    const req = ++nhtsaReq;
    box.innerHTML = '<p class="note">Загружаю…</p>';
    try {
      const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`);
      if (!r.ok) throw new Error(r.status);
      const row = (await r.json()).Results?.[0] || {};
      if (req !== nhtsaReq) return;
      const rows = NHTSA_FIELDS.filter(([k]) => row[k] && row[k] !== "Not Applicable")
        .map(([k, label]) => `<tr><td>${label}</td><td>${esc(row[k])}</td></tr>`);
      box.innerHTML = rows.length
        ? `<table class="kv">${rows.join("")}</table>` + (rows.length < 4
          ? '<p class="note">Справочник США почти ничего не знает о машинах европейского рынка — это нормально.</p>' : "")
        : '<p class="note">Справочник США ничего не знает об этом VIN.</p>';
    } catch {
      if (req === nhtsaReq) box.innerHTML = '<p class="note">Справочник NHTSA сейчас недоступен.</p>';
    }
  }

  // ---------------------------------------------------------------- VIN form

  function run(raw) {
    const vin = raw.toUpperCase().replace(/[\s-]/g, "");
    $("vin").value = vin;
    const err = validate(vin);
    $("err").hidden = !err;
    $("err").textContent = err || "";
    if (err) { $("result").hidden = true; return; }

    const { brand, rows, notes } = decode(vin);
    $("basic").innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
    document.querySelector(".vinpos")?.remove();
    $("basic").insertAdjacentHTML("beforebegin", strip(vin));
    $("basic-note").innerHTML = notes.map(esc).join("<br>");
    $("basic-note").hidden = !notes.length;
    $("result").hidden = false;

    if (brand) {
      const radio = document.querySelector(`input[name=brand][value=${brand}]`);
      if (radio && !radio.checked) { radio.checked = true; renderCodes(); }
    }
    history.replaceState(null, "", "?vin=" + vin);
    loadNhtsa(vin);
  }

  $("form").addEventListener("submit", (e) => { e.preventDefault(); run($("vin").value); });

  // ---------------------------------------------------------------- option codes

  // Из произвольного текста достаём токены, похожие на коды опций. У BMW коды
  // часто пишут как S5ACA / S302A — приставку S и суффикс A снимаем.
  function parseCodes(text, brand) {
    const out = [];
    for (let t of text.toUpperCase().split(/[^0-9A-Z]+/)) {
      if (brand === "bmw") {
        if (/^S[0-9][0-9A-Z]{2}A?$/.test(t)) t = t.slice(1);
        if (/^[0-9][0-9A-Z]{2}A$/.test(t)) t = t.slice(0, 3);
        if (!/^[0-9][0-9A-Z]{2}$/.test(t)) continue;
      } else if (!/^[0-9A-Z]{3}$/.test(t) || !/\d/.test(t)) continue;
      if (!out.includes(t)) out.push(t);
    }
    return out;
  }

  const SEARCH = { bmw: "BMW SA code", mb: "Mercedes option code", audi: "Audi PR code" };

  function renderCodes() {
    const brand = document.querySelector("input[name=brand]:checked").value;
    const codes = parseCodes($("codes").value, brand);
    const dict = D.options[brand];
    const table = $("codes-out");
    table.hidden = !codes.length;
    let known = 0;
    table.tBodies[0].innerHTML = codes.map((c) => {
      if (dict[c]) { known++; return `<tr><td class="mono">${c}</td><td>${esc(dict[c])}</td></tr>`; }
      const q = encodeURIComponent(`${SEARCH[brand]} ${c}`);
      return `<tr class="unknown"><td class="mono">${c}</td><td>нет в справочнике · ` +
             `<a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">поискать</a></td></tr>`;
    }).join("");
    $("codes-note").textContent = codes.length
      ? `Найдено кодов: ${codes.length}, расшифровано: ${known}.` : "";
  }

  $("codes").addEventListener("input", renderCodes);
  document.querySelectorAll("input[name=brand]").forEach((r) => r.addEventListener("change", renderCodes));

  const start = new URLSearchParams(location.search).get("vin");
  if (start) run(start);
})();

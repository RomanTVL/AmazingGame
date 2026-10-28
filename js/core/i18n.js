// Локализация. Строки модулей сливаются через i18n.add(lang, table).
// Ключи — с префиксом модуля: 'combat.spell.fireball', 'item.wood' и т.п.

let active = null;

function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

export class I18n {
  constructor(settings) {
    this.settings = settings;
    this.tables = { ru: {}, en: {} };
    this.fallbacks = ['ru', 'en'];
    this.missing = new Set();
  }

  get lang() {
    return this.settings?.get('lang') || 'ru';
  }

  set lang(v) {
    this.settings?.set('lang', v);
  }

  /** Добавить строки. Вложенные объекты разворачиваются в ключи через точку. */
  add(lang, table) {
    const t = (this.tables[lang] ||= {});
    flatten(table, '', t);
  }

  has(key, lang = this.lang) {
    return key in (this.tables[lang] || {}) || this.fallbacks.some((l) => key in this.tables[l]);
  }

  raw(key) {
    const lang = this.lang;
    let s = this.tables[lang]?.[key];
    if (s === undefined) {
      for (const l of this.fallbacks) {
        s = this.tables[l]?.[key];
        if (s !== undefined) break;
      }
    }
    return s;
  }

  /**
   * Перевод. vars — подстановки {name}. Если строка — массив вариантов,
   * берётся vars.variant (число) по модулю длины, иначе первый.
   */
  t(key, vars) {
    let s = this.raw(key);
    if (s === undefined) {
      this.missing.add(key);
      return key;
    }
    if (Array.isArray(s)) {
      const v = vars && Number.isFinite(vars.variant) ? Math.abs(vars.variant | 0) : 0;
      s = s[v % s.length];
    }
    if (typeof s === 'function') return s(vars || {}, this);
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    return s;
  }

  /** «Грубая речь»: если настройка включена и есть rudeKey — берём его, иначе чистый вариант. */
  tRude(cleanKey, rudeKey, vars) {
    if (this.settings?.get('rudeSpeech') && rudeKey && this.has(rudeKey)) return this.t(rudeKey, vars);
    return this.t(cleanKey, vars);
  }

  /** Множественное число: forms = ['день','дня','дней'] (ru) или ['day','days'] (en). */
  plural(n, forms) {
    if (this.lang === 'ru' && forms.length >= 3) {
      const a = Math.abs(n) % 100;
      const b = a % 10;
      if (a > 10 && a < 20) return forms[2];
      if (b > 1 && b < 5) return forms[1];
      if (b === 1) return forms[0];
      return forms[2];
    }
    return n === 1 ? forms[0] : forms[forms.length - 1];
  }
}

export function setActiveI18n(i18n) {
  active = i18n;
}

/** Короткий доступ к активной локализации (для кода отрисовки). */
export function t(key, vars) {
  return active ? active.t(key, vars) : key;
}

export function tRude(cleanKey, rudeKey, vars) {
  return active ? active.tRude(cleanKey, rudeKey, vars) : cleanKey;
}

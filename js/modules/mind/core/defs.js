// Реестры модуля mind (thoughts, traits, skills) и все строки (ru/en).
import { THOUGHT_DEFS } from '../defs/thoughts.js';
import { TRAIT_DEFS } from '../defs/traits.js';
import { SKILL_DEFS } from '../defs/skills.js';
import { CHILDHOOD, ADULTHOOD, QUOTES, WISHES } from '../defs/bio.js';
import { LINES } from '../strings/lines.js';
import { UI_STRINGS } from '../strings/ui.js';

const OWNER = 'mind';

export function registerDefs(game) {
  const thoughts = game.defs.create('thoughts', { defaults: { mood: 0, stack: 1, stackFactor: 1 } });
  const traits = game.defs.create('traits', { defaults: { weight: 1, effects: {} } });
  const skills = game.defs.create('skills', { sortBy: 'order', defaults: { order: 100, workTypes: [] } });

  const tr = { ru: {}, en: {} };
  for (const d of THOUGHT_DEFS) {
    const { ru, en, ...rest } = d;
    thoughts.add({ ...rest, nameKey: `mind.thought.${d.id}` }, OWNER);
    tr.ru[d.id] = ru.label;
    tr.en[d.id] = (en || ru).label;
  }
  const trt = { ru: {}, en: {} };
  for (const d of TRAIT_DEFS) {
    const { ru, en, ...rest } = d;
    traits.add({ ...rest, nameKey: `mind.traits.${d.id}.name`, descKey: `mind.traits.${d.id}.desc` }, OWNER);
    trt.ru[d.id] = { name: ru.name, desc: ru.desc };
    trt.en[d.id] = { name: (en || ru).name, desc: (en || ru).desc };
  }
  const sk = { ru: {}, en: {} };
  for (const d of SKILL_DEFS) {
    const { ru, en, ...rest } = d;
    skills.add({ ...rest, nameKey: `mind.skills.${d.id}` }, OWNER);
    sk.ru[d.id] = ru;
    sk.en[d.id] = en || ru;
  }
  const bio = { ru: { child: {}, adult: {}, wish: {} }, en: { child: {}, adult: {}, wish: {} } };
  for (const [list, key] of [[CHILDHOOD, 'child'], [ADULTHOOD, 'adult']])
    for (const b of list) {
      bio.ru[key][b.id] = b.ru;
      bio.en[key][b.id] = b.en || b.ru;
    }
  for (const w of WISHES) {
    bio.ru.wish[w.id] = w.ru;
    bio.en.wish[w.id] = w.en;
  }
  bio.ru.quote = QUOTES.map((q) => q.ru);
  bio.en.quote = QUOTES.map((q) => q.en);

  for (const lang of ['ru', 'en']) {
    game.i18n.add(lang, {
      mind: {
        ...UI_STRINGS[lang],
        thought: tr[lang],
        traits: trt[lang],
        skills: sk[lang],
        bio: bio[lang],
        say: LINES[lang],
      },
    });
  }
  game.i18n.add('ru', { mind: MORE.ru });
  game.i18n.add('en', { mind: MORE.en });
}

/** Дополнительные строки движка (не вошедшие в черновик). */
const MORE = {
  ru: {
    job: { talk: 'разговаривает', joy: 'отдыхает', break: 'срыв', eat: 'ест', brawl: 'дерётся', event: 'смотрит в окно' },
    passionShort: { minor: '♥', major: '♥♥' },
    misc: {
      mood: 'Настроение', authority: 'Авторитет', leaderOpinion: 'Мнение о проводнике', incapable: 'Неспособен: {list}',
      noBio: 'Прошлое неизвестно.', wish: 'Мечтает: {wish}', unknown: 'Неизвестно', you: 'это вы', role: 'Роль',
    },
    work: { dumb_labor: 'чёрная работа', violent: 'насилие', caring: 'уход за больными', intellectual: 'умственный труд', social: 'беседы по душам' },
    whisperLeader: 'Кто-то {place} говорит о проводнике.',
    eulogyTitle: 'Прощальное слово',
    insp: { spark: 'Вдохновение!' },
    deer: 'Гляди, олень!',
  },
  en: {
    job: { talk: 'talking', joy: 'relaxing', break: 'mental break', eat: 'eating', brawl: 'fighting', event: 'looking out the window' },
    passionShort: { minor: '♥', major: '♥♥' },
    misc: {
      mood: 'Mood', authority: 'Authority', leaderOpinion: 'Opinion of the conductor', incapable: 'Incapable of: {list}',
      noBio: 'Past unknown.', wish: 'Dreams of: {wish}', unknown: 'Unknown', you: 'that is you', role: 'Role',
    },
    work: { dumb_labor: 'dumb labor', violent: 'violence', caring: 'caring for the sick', intellectual: 'intellectual work', social: 'heart-to-hearts' },
    whisperLeader: 'Someone {place} is talking about the conductor.',
    eulogyTitle: 'Farewell words',
    insp: { spark: 'Inspired!' },
    deer: 'Look, a deer!',
  },
};

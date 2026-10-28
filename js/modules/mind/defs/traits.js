// Черты характера (game.defs.traits). Эффекты — данные, их читают системы mind:
//   baseMood (очки настроения, постоянно), workSpeed (множитель скорости работы), joyDecay/foodDecay/restDecay
//   (множители расхода), breakShift (сдвиг порогов срыва, + — ломается раньше), comfortNeed/beautyNeed (0 — нет нужды),
//   griefMul (горе), smallJoyMul (маленькие радости), opinionOfMe (базовое мнение окружающих), skills ({id: +n}),
//   insultMul/jokeMul/deepMul/comfortMul/romanceMul (выбор взаимодействий), thoughtMul ({thoughtId: множитель}),
//   breakWeights ({kind: множитель}), joyWeights ({activity: множитель}), refuseJobs (подстроки id задач).
// gen: false — не выпадает случайно (даётся событиями); hidden: true — скрытая (в карточке «???» до раскрытия).
export const TRAIT_DEFS = [
  {
    id: 'workaholic', weight: 6, conflicts: ['lazy'],
    effects: { workSpeed: 1.15, joyDecay: 0.7, thoughtMul: { bored: 0.5 } },
    ru: { name: 'Трудоголик', desc: 'Без дела места себе не находит. Работает быстрее, отдых нужен реже.' },
    en: { name: 'Workaholic', desc: 'Restless without a task. Works faster, needs less recreation.' },
  },
  {
    id: 'lazy', weight: 6, conflicts: ['workaholic'],
    effects: { workSpeed: 0.8, joyDecay: 1.3, restDecay: 1.15 },
    ru: { name: 'Лентяй', desc: 'Любая работа подождёт до завтра. Работает медленнее, чаще отдыхает.' },
    en: { name: 'Lazy', desc: 'Every job can wait till tomorrow. Works slower, rests more often.' },
  },
  {
    id: 'bloodthirsty', weight: 4, conflicts: ['softhearted'],
    effects: { skills: { melee: 2 }, insultMul: 1.4, thoughtMul: { saw_corpse: 0, execution_witnessed: 0, colonist_died: 0.6 }, breakWeights: { berserk: 3, tantrum: 1.5 } },
    ru: { name: 'Кровожадный', desc: 'Вид крови его не пугает, а бодрит. Трупы не портят ему настроение.' },
    en: { name: 'Bloodthirsty', desc: 'The sight of blood perks him up. Corpses do not spoil his mood.' },
  },
  {
    id: 'soft', weight: 5, conflicts: ['ascetic'],
    effects: { comfortNeed: 1.5, beautyNeed: 1.4, thoughtMul: { slept_on_floor: 2, ate_raw: 1.6, ate_without_table: 1.5, cold: 1.4 }, skills: { mining: -1, construction: -1 } },
    ru: { name: 'Неженка', desc: 'Привык к мягкой постели и горячему обеду. Неудобства переносит тяжело.' },
    en: { name: 'Pampered', desc: 'Used to a soft bed and a hot dinner. Takes every hardship hard.' },
  },
  {
    id: 'glutton', weight: 5,
    effects: { foodDecay: 1.4, thoughtMul: { ate_meal: 1.5, hungry: 1.3 }, breakWeights: { food_binge: 3 } },
    ru: { name: 'Обжора', desc: 'Ест за двоих и всё равно голоден. При срыве опустошает кладовую.' },
    en: { name: 'Glutton', desc: 'Eats for two and is still hungry. Raids the pantry when breaking.' },
  },
  {
    id: 'pyromaniac', weight: 3,
    effects: { joyWeights: { warm_hands: 3, stargazing: 0.6 }, thoughtMul: { warmed_at_fire: 2 }, breakWeights: { fire_gazing: 4 } },
    ru: { name: 'Пироман', desc: 'Огонь для него — лучшее зрелище. Подолгу смотрит в топку, при срыве не отходит от огня.' },
    en: { name: 'Pyromaniac', desc: 'Fire is the best show there is. Stares into the firebox for hours.' },
  },
  {
    id: 'optimist', weight: 6, conflicts: ['pessimist'],
    effects: { baseMood: 8, jokeMul: 1.5 },
    ru: { name: 'Оптимист', desc: 'Даже в Гнили найдёт, чему порадоваться.' },
    en: { name: 'Optimist', desc: 'Finds a reason to smile even in the Rot.' },
  },
  {
    id: 'pessimist', weight: 6, conflicts: ['optimist'],
    effects: { baseMood: -8, breakWeights: { give_up_leave: 2 } },
    ru: { name: 'Пессимист', desc: 'Знает, что всё кончится плохо. Чаще всего прав.' },
    en: { name: 'Pessimist', desc: 'Knows it will all end badly. Usually right.' },
  },
  {
    id: 'nervous', weight: 5, conflicts: ['iron_will'],
    effects: { breakShift: 0.08 },
    ru: { name: 'Нервный', desc: 'Вздрагивает от каждого гудка. Срывается раньше других.' },
    en: { name: 'Nervous', desc: 'Jumps at every horn. Breaks down sooner than others.' },
  },
  {
    id: 'iron_will', weight: 4, conflicts: ['nervous'],
    effects: { breakShift: -0.1 },
    ru: { name: 'Железная воля', desc: 'Держится, когда остальные уже сломались.' },
    en: { name: 'Iron will', desc: 'Holds on when everyone else has broken.' },
  },
  {
    id: 'addictive', weight: 4,
    effects: { breakWeights: { drug_binge: 4 } },
    ru: { name: 'Склонен к зависимостям', desc: 'Одна понюшка — и уже не остановиться. При срыве тянется к веществам.' },
    en: { name: 'Addictive', desc: 'One sniff and there is no stopping. Reaches for substances when breaking.' },
  },
  {
    id: 'beautiful', weight: 3, conflicts: ['ugly'],
    effects: { opinionOfMe: 15, romanceMul: 1.6 },
    ru: { name: 'Красавец', desc: 'На него приятно смотреть — и окружающие это ценят.' },
    en: { name: 'Beautiful', desc: 'Easy on the eyes — and people appreciate it.' },
  },
  {
    id: 'ugly', weight: 3, conflicts: ['beautiful'],
    effects: { opinionOfMe: -15, romanceMul: 0.5 },
    ru: { name: 'Уродливый', desc: 'Лицо, которое лучше видеть в полумраке вагона.' },
    en: { name: 'Ugly', desc: 'A face best seen in the dim light of a wagon.' },
  },
  {
    id: 'gourmet', weight: 4, conflicts: ['ascetic'],
    effects: { skills: { cooking: 2 }, thoughtMul: { ate_meal: 2.2, ate_raw: 2, ate_ration: 3 } },
    ru: { name: 'Гурман', desc: 'Сухпаёк для него — оскорбление. Хорошая еда — праздник.' },
    en: { name: 'Gourmet', desc: 'A ration is an insult. A good meal is a feast.' },
  },
  {
    id: 'ascetic', weight: 4, conflicts: ['soft', 'gourmet'],
    effects: { comfortNeed: 0, beautyNeed: 0.3, thoughtMul: { slept_on_floor: 0, ate_raw: 0, ate_ration: 0, ate_without_table: 0, ate_meal: 0.3 } },
    ru: { name: 'Аскет', desc: 'Спит на голых досках и ест что дадут. Роскошь ему безразлична.' },
    en: { name: 'Ascetic', desc: 'Sleeps on bare planks, eats whatever is given. Indifferent to luxury.' },
  },
  {
    id: 'cynic', weight: 5,
    effects: { smallJoyMul: 0.5, jokeMul: 1.8, insultMul: 1.3, deepMul: 0.6, breakWeights: { insult_spree: 2 } },
    ru: { name: 'Циник', desc: 'Смеётся там, где другие плачут. Маленькие радости его почти не трогают.' },
    en: { name: 'Cynic', desc: 'Laughs where others weep. Small joys barely touch him.' },
  },
  {
    id: 'softhearted', weight: 5, conflicts: ['bloodthirsty'],
    effects: { griefMul: 1.5, comfortMul: 2, insultMul: 0.3, joyWeights: { visit_memorial: 2, pet_cat: 2 }, thoughtMul: { execution_witnessed: 1.8, cremated_horror: 1.5 } },
    ru: { name: 'Мягкосердечный', desc: 'Чужую боль чувствует как свою. Тяжелее переживает утраты, чаще утешает.' },
    en: { name: 'Softhearted', desc: 'Feels others’ pain as his own. Grieves harder, comforts more.' },
  },
  // --- черты пути (PLAN §16.4) ---
  {
    id: 'motion_sick', weight: 3,
    effects: {},
    ru: { name: 'Укачивает', desc: 'В пути мутит (−4), зато на стоянке радуется твёрдой земле (+2).' },
    en: { name: 'Motion sick', desc: 'Queasy while travelling (−4), glad of solid ground at stations (+2).' },
  },
  {
    id: 'son_of_engineer', weight: 3,
    effects: { skills: { mining: 1, crafting: 1 } },
    ru: { name: 'Сын машиниста', desc: 'Вырос у топки. Кочегарит точнее и экономнее.' },
    en: { name: 'Engineer’s child', desc: 'Grew up by a firebox. Stokes more precisely and saves fuel.' },
  },
  {
    id: 'afraid_of_heights', weight: 3,
    effects: { refuseJobs: ['roof', 'turret', 'tower', 'climb'] },
    ru: { name: 'Боится высоты', desc: 'Ни за что не полезет на крышу вагона или к турели.' },
    en: { name: 'Afraid of heights', desc: 'Will never climb onto a wagon roof or man a turret.' },
  },
  {
    id: 'sleeper_counter', weight: 3,
    effects: { joyWeights: { look_out_window: 2.5 } },
    ru: { name: 'Считает шпалы', desc: 'Может часами смотреть в окно на ходу (+3 у окна в пути).' },
    en: { name: 'Sleeper counter', desc: 'Can watch the sleepers fly by for hours (+3 at a window on the move).' },
  },
  {
    id: 'widowed', weight: 0, gen: false,
    effects: { breakShift: -0.05, griefMul: 1.2 },
    ru: { name: 'Вдова/вдовец', desc: 'Потеря закалила: горе долгое, но и стойкость выше.' },
    en: { name: 'Widowed', desc: 'Loss has hardened this one: long grief, but stronger resolve.' },
  },
  // --- скрытые (сценарии) ---
  {
    id: 'runaway_debtor', weight: 0, gen: false, hidden: true,
    effects: {},
    ru: { name: 'Беглый должник', desc: 'Сбежал от кредиторов. Рано или поздно они придут за долгом.' },
    en: { name: 'Runaway debtor', desc: 'Fled from creditors. Sooner or later they will come to collect.' },
  },
  {
    id: 'ex_cultist', weight: 0, gen: false, hidden: true,
    effects: {},
    ru: { name: 'Бывший культист', desc: 'Когда-то молился Гнили. Чует её фронт точнее любых карт — а Культ зовёт назад.' },
    en: { name: 'Ex-cultist', desc: 'Once prayed to the Rot. Senses its front better than any map — and the Cult calls back.' },
  },
];

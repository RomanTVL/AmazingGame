// Биографии: детство и взрослая жизнь (бонусы навыков и «неспособен к…»), цитаты, мечты.
// Тексты написаны без родовых окончаний там, где это возможно; где нельзя — пара {m, f}.
// incapable — id типов работ ядра или теги: dumb_labor (переноска, уборка, добыча), violent (охота и бой),
//   caring (лечение), intellectual (знания), social (не заводит разговоров по душам, торговля хуже).
export const INCAPABLE_TAGS = {
  dumb_labor: ['hauling', 'cleaning', 'mining'],
  violent: ['hunting'],
  caring: ['doctoring'],
  intellectual: ['research'],
  social: [],
};

export const CHILDHOOD = [
  {
    id: 'fisher_village', skills: { cooking: 1, plants: 1, crafting: 1 },
    ru: { title: 'Рыбацкая деревня', desc: 'Детство на берегу холодного озера: сети, соль и лодки, которые иногда не возвращались.', line: 'У нас на озере говорили: лёд трещит — значит, живой. Я до сих пор прислушиваюсь к стуку колёс так же.' },
    en: { title: 'Fishing village', desc: 'A childhood on a cold lake shore: nets, salt and boats that sometimes never came back.', line: 'On our lake they said: if the ice cracks, it is alive. I still listen to the wheels the same way.' },
  },
  {
    id: 'rail_orphan', skills: { mining: 2, crafting: 1 },
    ru: { title: 'Сирота при депо', desc: 'Вырос среди паровозов и угольной пыли. Спал на мешках, ел то, что оставляли машинисты.', line: 'В депо меня кормили машинисты. Кто хлебом, кто подзатыльником. Хлеб я запомнил лучше.' },
    en: { title: 'Depot orphan', desc: 'Raised among engines and coal dust. Slept on sacks, ate whatever the drivers left.', line: 'At the depot the drivers fed me. Some with bread, some with a cuff on the ear. I remember the bread better.' },
  },
  {
    id: 'herbalist_apprentice', skills: { medicine: 3, plants: 1 },
    ru: { title: 'Ученик травницы', desc: 'С малых лет собирал корни и мох для деревенской знахарки. Знает, какая трава лечит, а какая убивает.', line: 'Бабка-травница учила: любая трава — лекарство, вопрос только в мере. С людьми так же.' },
    en: { title: 'Herbalist’s apprentice', desc: 'Gathered roots and moss for the village healer from an early age. Knows which herb heals and which kills.', line: 'The old herbalist taught me: every herb is medicine, it is all in the dose. Same with people.' },
  },
  {
    id: 'noble_brat', skills: { social: 2, trade: 1, intellect: 1 }, incapable: ['dumb_labor'],
    ru: { title: 'Барчук из усадьбы', desc: 'Детство в усадьбе с гувернёрами и фарфором. До двенадцати лет искренне считалось, что бельё стирается само.', line: 'У нас была усадьба с сорока окнами. Теперь у меня одно — и оно трясётся. Зато вид лучше.' },
    en: { title: 'Manor brat', desc: 'A childhood of tutors and porcelain. Until twelve, laundry was honestly believed to wash itself.', line: 'We had a manor with forty windows. Now I have one, and it rattles. The view is better, though.' },
  },
  {
    id: 'street_thief', skills: { trade: 2, melee: 1, social: 1 },
    ru: { title: 'Карманник с рынка', desc: 'Рынок кормил тех, у кого ловкие пальцы. Научился торговаться раньше, чем писать своё имя.', line: 'На рынке я понял главное: кошелёк ближе всего у того, кто громче всех кричит о ворах.' },
    en: { title: 'Market pickpocket', desc: 'The market fed those with quick fingers. Learned to haggle before learning to write a name.', line: 'At the market I learned the main thing: the purse is closest on the one who shouts loudest about thieves.' },
  },
  {
    id: 'cult_child', skills: { magic: 1, intellect: 1, social: 1 },
    ru: { title: 'Дитя секты', desc: 'Детство в общине, ждавшей конца света. Конец света пришёл — только не тот, которого ждали.', line: 'Нас учили, что мир кончится в огне. Он кончается в сером тумане. Проповедники ошиблись даже в этом.' },
    en: { title: 'Child of a sect', desc: 'Grew up in a commune waiting for the end of the world. It came — just not the one they expected.', line: 'They taught us the world would end in fire. It is ending in grey fog. The preachers were wrong even about that.' },
  },
  {
    id: 'miner_kid', skills: { mining: 3, construction: 1 },
    ru: { title: 'Шахтёрский посёлок', desc: 'С девяти лет таскал вагонетки в штольне. Темноты не боится — боится тишины в забое.', line: 'В шахте страшна не темнота. Страшно, когда крепь перестаёт скрипеть. Значит, сейчас рухнет.' },
    en: { title: 'Mining town', desc: 'Pushed carts in the adit from the age of nine. Not afraid of the dark — afraid of silence in the shaft.', line: 'In the mine the dark is not what scares you. It is when the props stop creaking. That means they are about to give.' },
  },
  {
    id: 'forest_hunter', skills: { shooting: 2, plants: 2 },
    ru: { title: 'Дитя лесника', desc: 'Рос в сторожке посреди Леса Шёпота. Читает следы лучше, чем буквы.', line: 'Отец говорил: лес не злой, он просто голодный. Как и мы.' },
    en: { title: 'Forester’s child', desc: 'Grew up in a lodge deep in the Whispering Forest. Reads tracks better than letters.', line: 'Father used to say: the forest is not cruel, just hungry. Same as us.' },
  },
  {
    id: 'war_refugee', skills: { melee: 1, medicine: 1, construction: 1 },
    ru: { title: 'Беженец войны', desc: 'Детство в обозах и чужих сараях. Слишком рано узнал, как пахнет горящий дом.', line: 'Когда я был маленьким, мы тоже бежали. Тогда я думал, что бегут всегда только от чего-то. А мы — к чему-то.' },
    en: { title: 'War refugee', desc: 'A childhood of wagon trains and strangers’ barns. Learned too early what a burning house smells like.', line: 'When I was small we ran too. Back then I thought you only ever run from something. We are running towards something.' },
  },
  {
    id: 'monastery_novice', skills: { intellect: 2, medicine: 1, plants: 1 }, incapable: ['violent'],
    ru: { title: 'Послушник Тихих', desc: 'Отдан в монастырь Тихих ещё ребёнком. Дал обет не поднимать руку на живое — и держит его.', line: 'Тихие говорят: слово — это камень, брошенный в колодец. Пока летит, его ещё можно поймать.' },
    en: { title: 'Novice of the Silent', desc: 'Given to the Silent monastery as a child. Took a vow never to raise a hand against the living — and keeps it.', line: 'The Silent say: a word is a stone dropped into a well. While it falls, you can still catch it.' },
  },
  {
    id: 'circus_child', skills: { social: 2, melee: 1, crafting: 1 },
    ru: { title: 'Дитя бродячего цирка', desc: 'Вырос в фургоне с акробатами. Жонглировал ножами раньше, чем научился считать до десяти.', line: 'В цирке меня учили падать. Главное — не как упасть, а как встать, пока публика не заметила.' },
    en: { title: 'Travelling circus', desc: 'Raised in a wagon full of acrobats. Juggled knives before counting to ten.', line: 'In the circus they taught me to fall. The trick is not how you fall, but how you get up before the crowd notices.' },
  },
  {
    id: 'bakers_kid', skills: { cooking: 3 },
    ru: { title: 'Дитя пекаря', desc: 'Вставал в четыре утра месить тесто. Запах свежего хлеба до сих пор пахнет домом.', line: 'Отец пёк хлеб на всю улицу. Говорил: голодный сосед опаснее сытого волка.' },
    en: { title: 'Baker’s child', desc: 'Up at four every morning kneading dough. Fresh bread still smells like home.', line: 'Father baked bread for the whole street. He said a hungry neighbour is more dangerous than a fed wolf.' },
  },
  {
    id: 'smith_apprentice', skills: { crafting: 3, construction: 1 },
    ru: { title: 'Подмастерье кузнеца', desc: 'Детство у горна: искры, копоть и мозоли на ладонях с десяти лет.', line: 'Кузнец говорил: железо не врёт. Перекалишь — треснет. С людьми, кстати, так же.' },
    en: { title: 'Blacksmith’s apprentice', desc: 'A childhood by the forge: sparks, soot and calloused palms from the age of ten.', line: 'The smith used to say: iron never lies. Overheat it and it cracks. People too, by the way.' },
  },
  {
    id: 'shepherd', skills: { plants: 2, melee: 1 },
    ru: { title: 'Пастушок', desc: 'Лето за летом на дальних выпасах с отарой и собакой. Привык к одиночеству и звёздам.', line: 'Я пас овец на холмах. Ночью считал звёзды, чтобы не уснуть. Сбивался всегда на трёхсотой.' },
    en: { title: 'Shepherd', desc: 'Summer after summer on far pastures with a flock and a dog. Used to solitude and stars.', line: 'I watched sheep on the hills. At night I counted stars to stay awake. Always lost count at three hundred.' },
  },
  {
    id: 'plague_survivor', skills: { medicine: 2, construction: 1 },
    ru: { title: 'Переживший мор', desc: 'В тот год, когда пришла лихорадка, из всей улицы выжил один ребёнок. С тех пор не боится болезней — и смерти.', line: 'На нашей улице после мора остались одни двери. Я тогда научился мыть руки и не плакать.' },
    en: { title: 'Plague survivor', desc: 'The year the fever came, one child survived on the whole street. Not afraid of disease since — or of death.', line: 'After the plague our street was nothing but doors. I learned to wash my hands and not to cry.' },
  },
  {
    id: 'librarian_kid', skills: { intellect: 3, social: 1 },
    ru: { title: 'Ребёнок при библиотеке', desc: 'Вырос между стеллажами городской библиотеки. Книги сгорели, а прочитанное осталось.', line: 'Библиотека сгорела за одну ночь. Зато всё, что я успел прочитать, Гниль из меня не вытащит.' },
    en: { title: 'Library child', desc: 'Grew up between the shelves of the town library. The books burned; what was read remained.', line: 'The library burned in one night. But whatever I managed to read, the Rot cannot pull out of me.' },
  },
  {
    id: 'smuggler_runner', skills: { trade: 2, shooting: 1, social: 1 },
    ru: { title: 'Гонец контрабандистов', desc: 'Бегал с записками и свёртками через границу. Знает, когда молчать и кому улыбаться.', line: 'Мне было десять, когда меня впервые обыскивал инквизитор. Он ничего не нашёл. Я спрятал всё в его же сапог.' },
    en: { title: 'Smugglers’ runner', desc: 'Carried notes and parcels across the border. Knows when to stay silent and whom to smile at.', line: 'I was ten when an inquisitor first searched me. He found nothing. I had hidden it all in his own boot.' },
  },
  {
    id: 'ice_village', skills: { construction: 1, mining: 1, shooting: 1 },
    ru: { title: 'Зимовье в пиках', desc: 'Детство в деревне, где зима длится девять месяцев. Знает цену дровам и тёплой печке.', line: 'У нас в пиках говорят: холод не убивает, убивает лень встать и подбросить полено.' },
    en: { title: 'Winter village', desc: 'Grew up where winter lasts nine months. Knows the price of firewood and a warm stove.', line: 'Up in the peaks we say: the cold does not kill you, being too lazy to add a log does.' },
  },
  {
    id: 'ash_scavenger', skills: { mining: 1, crafting: 2 },
    ru: { title: 'Старатель пустошей', desc: 'Перекапывал пепел мёртвых городов в поисках железа. Из хлама соберёт что угодно.', line: 'В пустошах из пепла выкапывают всё: ложки, кольца, зубы. Я однажды выкопал целый рояль. Без клавиш.' },
    en: { title: 'Ash scavenger', desc: 'Dug through the ash of dead towns for scrap iron. Can build anything out of junk.', line: 'In the wastes you dig everything out of the ash: spoons, rings, teeth. Once I dug up a whole piano. No keys.' },
  },
  {
    id: 'drowned_village', skills: { social: 1, plants: 1, cooking: 1 },
    ru: { title: 'Затопленная деревня', desc: 'Плотину прорвало ночью. С тех пор шум воды не даёт уснуть.', line: 'Наша деревня теперь на дне озера. Говорят, в тихую погоду с лодки видно колокольню.' },
    en: { title: 'Drowned village', desc: 'The dam broke at night. The sound of water still keeps sleep away.', line: 'Our village lies at the bottom of a lake now. They say on calm days you can see the bell tower from a boat.' },
  },
  {
    id: 'gravedigger_kid', skills: { construction: 2, mining: 1 },
    ru: { title: 'Дитя могильщика', desc: 'Лучше всех в деревне знал, кто умрёт следующим: по заказам отца. Мрачновато, зато к смерти привычка.', line: 'Отец копал могилы и всегда держал одну про запас. Говорил: кто-нибудь да пригодится. Ни разу не ошибся.' },
    en: { title: 'Gravedigger’s child', desc: 'Always knew who would die next in the village — from father’s orders. Grim, but it breeds familiarity with death.', line: 'Father dug graves and always kept one spare. Said someone would need it. He was never wrong.' },
  },
  {
    id: 'choir_kid', skills: { social: 2, magic: 1 },
    ru: { title: 'Певчий храмового хора', desc: 'Пел в хоре, пока не сломался голос. Колокольный звон до сих пор слышится во сне.', line: 'В хоре нас учили петь так, чтобы под куполом звенело. Под крышей вагона тоже звенит, если петь от души.' },
    en: { title: 'Temple choir', desc: 'Sang in the choir until the voice broke. Bells still ring in dreams.', line: 'In the choir they taught us to sing so the dome would ring. A wagon roof rings too, if you sing from the heart.' },
  },
  {
    id: 'tavern_kid', skills: { social: 2, cooking: 1, trade: 1 },
    ru: { title: 'Дитя трактирщика', desc: 'Разносил кружки в придорожном трактире. Слышал больше историй, чем любой сказочник.', line: 'В трактире я понял: человек врёт до третьей кружки, а после третьей — говорит правду. После пятой — поёт.' },
    en: { title: 'Innkeeper’s child', desc: 'Carried mugs in a roadside tavern. Heard more stories than any storyteller.', line: 'In the tavern I learned: a man lies until the third mug, tells the truth after it. After the fifth, he sings.' },
  },
  {
    id: 'lighthouse_kid', skills: { intellect: 1, crafting: 1, construction: 1 },
    ru: { title: 'Ребёнок смотрителя маяка', desc: 'Детство на скале посреди моря. Моря больше нет, а привычка зажигать свет в темноте осталась.', line: 'Отец зажигал маяк каждую ночь, даже когда кораблей не было годами. «Вдруг кто-то всё-таки плывёт».' },
    en: { title: 'Lighthouse child', desc: 'A childhood on a rock in the sea. The sea is gone, but the habit of lighting a lamp in the dark remains.', line: 'Father lit the lighthouse every night, even when no ship had come for years. "What if someone is out there."' },
  },
];

export const ADULTHOOD = [
  {
    id: 'stoker', skills: { mining: 3, construction: 1 },
    ru: { title: 'Кочегар товарняка', desc: 'Пятнадцать лет у топки грузового состава. Слышит, когда котлу плохо, раньше манометра.', line: 'Я кидал уголь пятнадцать лет. Знаешь, что самое трудное? Не уснуть, когда поезд поёт.' },
    en: { title: 'Freight stoker', desc: 'Fifteen years at the firebox of a freight train. Hears a sick boiler before the gauge does.', line: 'I shovelled coal for fifteen years. The hardest part? Not falling asleep when the train sings.' },
  },
  {
    id: 'field_medic', skills: { medicine: 4, melee: 1 },
    ru: { title: 'Полевой лекарь', desc: 'Штопал раненых под обстрелом. Руки не дрожат — дрожит что-то внутри, но этого не видно.', line: 'На войне я зашил больше ран, чем носков за всю жизнь. Носки, кстати, сложнее.' },
    en: { title: 'Field medic', desc: 'Stitched up the wounded under fire. The hands never shake — something inside does, but nobody sees it.', line: 'In the war I stitched more wounds than socks in my whole life. Socks are harder, by the way.' },
  },
  {
    id: 'mercenary', skills: { shooting: 3, melee: 3 },
    ru: { title: 'Наёмник', desc: 'Воевал за того, кто платил. Однажды заплатили обе стороны — пришлось выбирать по совести.', line: 'Наёмнику платят за то, чтобы он не задавал вопросов. Самый дорогой вопрос — «зачем».' },
    en: { title: 'Mercenary', desc: 'Fought for whoever paid. Once both sides paid — had to choose by conscience.', line: 'A mercenary is paid not to ask questions. The most expensive one is "why".' },
  },
  {
    id: 'tax_collector', skills: { trade: 3, social: 1, intellect: 1 },
    ru: { title: 'Сборщик податей', desc: 'Ездил по деревням с печатью и охраной. Привык, что его не любят, и научился с этим жить.', line: 'Я собирал подати десять лет. Меня ненавидели все, кроме лошади. Лошадь я кормил.' },
    en: { title: 'Tax collector', desc: 'Rode from village to village with a seal and guards. Got used to being disliked and learned to live with it.', line: 'I collected taxes for ten years. Everyone hated me except my horse. I fed the horse.' },
  },
  {
    id: 'army_cook', skills: { cooking: 4, melee: 1 },
    ru: { title: 'Повар полевой кухни', desc: 'Кормил полк из одного котла. Знает сорок способов приготовить крапиву и все сорок — съедобны.', line: 'В полку я кормил триста ртов из одного котла. Здесь ртов меньше, а ворчат так же.' },
    en: { title: 'Field kitchen cook', desc: 'Fed a regiment from a single pot. Knows forty ways to cook nettles, and all forty are edible.', line: 'In the regiment I fed three hundred mouths from one pot. Fewer mouths here, but they grumble just the same.' },
  },
  {
    id: 'carpenter', skills: { construction: 4, crafting: 2 },
    ru: { title: 'Плотник', desc: 'Строил мосты, амбары и колыбели. Всё, что построено, стоит до сих пор — то, что не съела Гниль.', line: 'Я строил дома. Хороший дом скрипит, как старик, но стоит сто лет. Вагон, кстати, тоже скрипит.' },
    en: { title: 'Carpenter', desc: 'Built bridges, barns and cradles. Everything built still stands — whatever the Rot has not eaten.', line: 'I built houses. A good house creaks like an old man but stands a hundred years. This wagon creaks too.' },
  },
  {
    id: 'rot_hunter', skills: { shooting: 4, plants: 1 },
    ru: { title: 'Охотник на гнилых волков', desc: 'Выслеживал тварей у кромки Гнили за награду. Награды не всегда хватало на патроны.', line: 'Гнилой волк воет не от голода. Он воет, потому что помнит, каким был. Я стреляю быстро, чтобы он не вспоминал долго.' },
    en: { title: 'Rot-wolf hunter', desc: 'Tracked beasts at the edge of the Rot for bounties. The bounty did not always cover the bullets.', line: 'A rot wolf does not howl from hunger. It howls because it remembers what it was. I shoot fast so it does not remember long.' },
  },
  {
    id: 'scholar', skills: { intellect: 4, magic: 1 }, incapable: ['dumb_labor'],
    ru: { title: 'Книжник из Ржавого Узла', desc: 'Переписывал старые карты и спорил с учёными мужами. Убеждён, что лопата — инструмент для других.', line: 'Я изучал старые карты. На всех них этой дороги нет. А мы по ней едем. Интересно, правда?' },
    en: { title: 'Scholar of Rusty Junction', desc: 'Copied old maps and argued with learned men. Convinced that a shovel is a tool for other people.', line: 'I studied old maps. This road is on none of them. And yet we ride it. Curious, isn’t it?' },
  },
  {
    id: 'farmer', skills: { plants: 4, cooking: 1 },
    ru: { title: 'Крестьянин', desc: 'Пахал, сеял и молился о дожде. Земля ушла под Гниль, а руки помнят, как её держать.', line: 'Земля всегда отдаёт, если с ней по-честному. Я надеюсь, где-то впереди ещё есть честная земля.' },
    en: { title: 'Farmer', desc: 'Ploughed, sowed and prayed for rain. The land went under the Rot, but the hands remember how to hold it.', line: 'The soil always gives back if you deal with it honestly. I hope there is still honest soil somewhere ahead.' },
  },
  {
    id: 'smuggler', skills: { trade: 3, shooting: 2 },
    ru: { title: 'Контрабандист', desc: 'Возил через кордоны то, что нельзя. Инквизиция до сих пор хранит его портрет — не очень похожий.', line: 'У Инквизиции есть мой портрет. Нос там большеват. Я бы на их месте за такой портрет постыдился.' },
    en: { title: 'Smuggler', desc: 'Moved forbidden goods past cordons. The Inquisition still keeps a portrait — not a good likeness.', line: 'The Inquisition has my portrait. The nose is too big. If I were them I would be ashamed of that portrait.' },
  },
  {
    id: 'priest', skills: { social: 3, medicine: 1 }, incapable: ['violent'],
    ru: { title: 'Пастырь без паствы', desc: 'Последний священник опустевшего прихода. Не поднимет оружия, но выслушает любого.', line: 'Мой приход ушёл в Гниль за одну зиму. Я остался служить пустым скамьям. Теперь служу вагону — тут хотя бы отвечают.' },
    en: { title: 'Shepherd without a flock', desc: 'The last priest of an emptied parish. Will not raise a weapon, but will listen to anyone.', line: 'My parish went into the Rot in one winter. I stayed to preach to empty pews. Now I serve a wagon — at least here someone answers.' },
  },
  {
    id: 'pass_guard', skills: { melee: 3, shooting: 2 },
    ru: { title: 'Стражник на перевале', desc: 'Двадцать зим охранял горный перевал. Знает, как стоять на ветру и не моргать.', line: 'На перевале я двадцать зим смотрел на дорогу. Теперь дорога смотрит на меня из окна.' },
    en: { title: 'Pass guard', desc: 'Guarded a mountain pass for twenty winters. Knows how to stand in the wind without blinking.', line: 'At the pass I watched the road for twenty winters. Now the road watches me through the window.' },
  },
  {
    id: 'miner', skills: { mining: 4, construction: 1 },
    ru: { title: 'Рудокоп', desc: 'Долбил руду в глубоких штольнях. Пережил два обвала и одного начальника артели.', line: 'Два обвала пережил. Под вторым сутки лежал и пел, чтобы не сойти с ума. Теперь пою, только когда страшно.' },
    en: { title: 'Ore miner', desc: 'Hacked ore in deep shafts. Survived two cave-ins and one foreman.', line: 'Survived two cave-ins. Under the second I lay a whole day singing so as not to go mad. Now I only sing when I am scared.' },
  },
  {
    id: 'tailor', skills: { crafting: 4, social: 1 },
    ru: { title: 'Портной', desc: 'Шил свадебные платья и саваны — иногда для одних и тех же людей.', line: 'Я шил и свадебные наряды, и саваны. Мерки снимаются одинаково, только на свадьбе люди вертятся.' },
    en: { title: 'Tailor', desc: 'Sewed wedding dresses and shrouds — sometimes for the same people.', line: 'I sewed wedding clothes and shrouds. The measurements are taken the same way, only at weddings people fidget.' },
  },
  {
    id: 'inquisition_deserter', skills: { shooting: 2, melee: 2, intellect: 1 },
    ru: { title: 'Дезертир Инквизиции', desc: 'Носил серый плащ и жёг «заражённые» дома. Однажды отказался — и с тех пор бежит.', line: 'Я служил Инквизиции. Однажды нам велели сжечь деревню, где не было ни одного больного. Я ушёл той же ночью.' },
    en: { title: 'Inquisition deserter', desc: 'Wore the grey cloak and burned "infected" homes. Refused once — and has been running ever since.', line: 'I served the Inquisition. One day we were ordered to burn a village without a single sick person in it. I left that same night.' },
  },
  {
    id: 'gambler', skills: { trade: 2, social: 2 },
    ru: { title: 'Игрок', desc: 'Проиграл дом, лодку и честное имя. Лодку жальче всего.', line: 'Я проиграл в кости всё, что у меня было. Кроме удачи — её у меня, видимо, и не было.' },
    en: { title: 'Gambler', desc: 'Lost a house, a boat and a good name at dice. Misses the boat the most.', line: 'I lost everything I had at dice. Except luck — apparently I never had any.' },
  },
  {
    id: 'undertaker', skills: { construction: 2, crafting: 2 },
    ru: { title: 'Гробовщик', desc: 'Хоронил чужих за деньги. Своих — бесплатно, и это было хуже.', line: 'Гробовщик видит людей честными: никто не лежит в гробу с выпяченной грудью.' },
    en: { title: 'Undertaker', desc: 'Buried strangers for money. Buried family for free, and that was worse.', line: 'An undertaker sees people honestly: nobody lies in a coffin with his chest puffed out.' },
  },
  {
    id: 'rune_trackman', skills: { magic: 3, construction: 1, intellect: 1 },
    ru: { title: 'Ученик рунного путейца', desc: 'Подновлял руны на шпалах древней дороги. Чувствует, где путь болен.', line: 'Каждая шпала этой дороги подписана руной. Я как-то нашёл одну с моим именем. До сих пор не знаю, что это значит.' },
    en: { title: 'Rune trackman’s apprentice', desc: 'Renewed the runes on the sleepers of the ancient road. Can feel where the track is sick.', line: 'Every sleeper on this road is signed with a rune. Once I found one with my own name. Still do not know what it means.' },
  },
  {
    id: 'innkeeper', skills: { cooking: 2, social: 2, trade: 1 },
    ru: { title: 'Хозяин постоялого двора', desc: 'Держал постоялый двор на тракте. Умеет накормить, уложить и выставить за дверь — по очереди.', line: 'На постоялом дворе я понял: хорошему гостю нужна тёплая постель, плохому — крепкая дверь.' },
    en: { title: 'Innkeeper', desc: 'Kept a coaching inn on the highway. Knows how to feed, bed down and throw out — in that order.', line: 'Running an inn taught me: a good guest needs a warm bed, a bad one needs a sturdy door.' },
  },
  {
    id: 'beekeeper', skills: { plants: 2, crafting: 1, medicine: 1 },
    ru: { title: 'Пчеловод', desc: 'Держал пасеку у старого кладбища. Пчёлы жалили всех, кроме хозяина.', line: 'Пчёлы чуют страх. Поэтому я с ними всегда разговаривал — тихо, про погоду. Помогало обоим.' },
    en: { title: 'Beekeeper', desc: 'Kept hives by an old graveyard. The bees stung everyone except their keeper.', line: 'Bees smell fear. So I always talked to them — quietly, about the weather. It helped us both.' },
  },
  {
    id: 'burglar', skills: { crafting: 2, melee: 1, trade: 1 },
    ru: { title: 'Взломщик', desc: 'Открывал любые замки, кроме одного — сердечного. Сидел дважды.', line: 'Любой замок открывается. Вопрос в том, хочешь ли ты знать, что за дверью.' },
    en: { title: 'Burglar', desc: 'Opened any lock but one — the heart’s. Did time twice.', line: 'Every lock opens. The question is whether you want to know what is behind the door.' },
  },
  {
    id: 'sailor', skills: { construction: 1, shooting: 1, social: 1, crafting: 1 },
    ru: { title: 'Моряк без моря', desc: 'Ходил на торговых судах, пока море не высохло. Остался моряком без моря.', line: 'Поезд — тот же корабль, только волны железные. Качает меньше, а тоска та же.' },
    en: { title: 'Sailor without a sea', desc: 'Served on merchant ships until the sea dried up. Left a sailor without a sea.', line: 'A train is the same as a ship, only the waves are iron. It rocks less, but the longing is the same.' },
  },
  {
    id: 'rot_warden', skills: { shooting: 2, intellect: 2 },
    ru: { title: 'Смотритель кромки', desc: 'Отмечал на картах, где продвинулась Гниль. Видел, как исчезают деревни, — с именами, с собаками, с колыбелями.', line: 'Я каждый день отмечал на карте, где Гниль. Однажды стёр с карты свой дом. Своей рукой.' },
    en: { title: 'Rot warden', desc: 'Marked on maps where the Rot had spread. Watched villages vanish — names, dogs, cradles and all.', line: 'Every day I marked on the map where the Rot was. One day I erased my own home from it. With my own hand.' },
  },
  {
    id: 'ruined_noble', skills: { social: 2, trade: 2, intellect: 1 }, incapable: ['dumb_labor'],
    ru: { title: 'Разорившийся дворянин', desc: 'Фамилия древняя, карманы пустые. До сих пор держит спину, словно на балу.', line: 'Мой прадед построил полгорода. Я унаследовал его профиль и долги. Профиль, по крайней мере, хороший.' },
    en: { title: 'Ruined noble', desc: 'An ancient name and empty pockets. Still holds the back straight as if at a ball.', line: 'My great-grandfather built half a city. I inherited his profile and his debts. At least the profile is good.' },
  },
];

/** Запоминающиеся цитаты (показываются в карточке, health может взять в сцену смерти). */
export const QUOTES = [
  { ru: 'Пока колёса стучат — мы живы.', en: 'As long as the wheels knock, we are alive.' },
  { ru: 'Хлеб делят на всех, даже если его нет.', en: 'Bread is shared among all, even when there is none.' },
  { ru: 'Не бойся темноты. Бойся тишины.', en: 'Do not fear the dark. Fear the silence.' },
  { ru: 'Я ещё увижу море.', en: 'I will see the sea yet.' },
  { ru: 'Гниль меня не возьмёт — я невкусный.', en: 'The Rot won’t take me — I taste terrible.' },
  { ru: 'Каждая станция — чей-то дом. Был.', en: 'Every station is someone’s home. Was.' },
  { ru: 'Память — единственный багаж, который ничего не весит.', en: 'Memory is the only luggage that weighs nothing.' },
  { ru: 'Умирать — это для тех, у кого есть свободное время.', en: 'Dying is for people with free time.' },
  { ru: 'Если долго смотреть в топку, топка начинает смотреть в тебя.', en: 'Stare into the firebox long enough and it stares back.' },
  { ru: 'Лучше плохая дорога, чем хорошая остановка.', en: 'Better a bad road than a good stop.' },
  { ru: 'Кто помнит — тот и жив.', en: 'Whoever remembers is alive.' },
  { ru: 'Я не храбрый. Я просто не умею бегать.', en: 'I am not brave. I just can’t run.' },
  { ru: 'Чай решает половину бед. Вторую половину решает второй чай.', en: 'Tea solves half your troubles. The second cup solves the rest.' },
  { ru: 'Мир кончается, а посуду всё равно мыть.', en: 'The world is ending, and the dishes still need washing.' },
  { ru: 'Держись за поручень и за людей.', en: 'Hold on to the rail and to people.' },
  { ru: 'Никто не уходит, пока его помнят.', en: 'Nobody is gone while they are remembered.' },
  { ru: 'У страха глаза велики, а у Гнили — их нет вовсе.', en: 'Fear has big eyes. The Rot has none at all.' },
  { ru: 'Я спал на полу в трёх странах. Этот пол — лучший.', en: 'I have slept on floors in three countries. This floor is the best.' },
  { ru: 'Сначала доедем. Плакать будем потом.', en: 'First we get there. We can cry later.' },
  { ru: 'Всё можно починить, кроме времени.', en: 'Everything can be fixed except time.' },
  { ru: 'Гудок — это поезд так плачет, чтобы мы не плакали.', en: 'The horn is the train crying so that we don’t have to.' },
  { ru: 'Самое тёплое место в мире — рядом с тем, кто не спит.', en: 'The warmest place in the world is beside someone still awake.' },
];

/** Незакрытые мечты — для последних слов (health) и разговоров по душам. */
export const WISHES = [
  { id: 'sea', ru: 'увидеть море', en: 'see the sea' },
  { id: 'home', ru: 'вернуться в родную деревню', en: 'go back to my home village' },
  { id: 'teach', ru: 'научить кого-нибудь своему ремеслу', en: 'teach someone my trade' },
  { id: 'snow', ru: 'дожить до первого снега', en: 'live to see the first snow' },
  { id: 'heart', ru: 'доехать до Сердца мира', en: 'reach the Heart of the World' },
  { id: 'brother', ru: 'попросить прощения у брата', en: 'ask my brother for forgiveness' },
  { id: 'house', ru: 'построить свой дом', en: 'build a house of my own' },
  { id: 'wedding', ru: 'сыграть свадьбу', en: 'have a wedding' },
  { id: 'sister', ru: 'найти сестру', en: 'find my sister' },
  { id: 'bell', ru: 'услышать колокол родного храма', en: 'hear the bell of my home temple' },
  { id: 'apple', ru: 'увидеть, как цветёт яблоня', en: 'see an apple tree in bloom' },
  { id: 'debt', ru: 'отдать старый долг', en: 'repay an old debt' },
  { id: 'song', ru: 'допеть мамину песню до конца', en: 'sing mother’s song to the end' },
  { id: 'garden', ru: 'посадить сад', en: 'plant a garden' },
];

// Строки модуля build (ru, en).
export function registerStrings(game) {
  game.i18n.add('ru', {
    build: {
      panel: { title: 'Стройка' },
      tab: { walls: 'Стены и двери', furniture: 'Мебель', light: 'Свет', storage: 'Склад' },
      b: {
        wood_wall: 'Деревянная стена', stone_wall: 'Каменная стена', door_wood: 'Дверь', bed: 'Кровать', bedroll: 'Спальник',
        table: 'Стол', chair: 'Стул', torch: 'Факел', chest: 'Ящик', shelf: 'Стеллаж',
      },
      key: { rotate: 'Поворот чертежа', zones: 'Зоны складов', clear: 'Снести / отменить' },
      job: { deliver: 'несёт материалы', construct: 'строит', deconstruct: 'разбирает' },
      des: { deconstruct: 'Разобрать' },
      zone: { stockpile: 'Склад', n: 'Склад {n}' },
      filter: { label: 'Фильтр:', all: 'Всё', resources: 'Ресурсы', food: 'Еда', medicine: 'Лекарства' },
      act: {
        construct: 'Строить: {name} ({pct}%) — держите',
        give: 'Отдать {what} ×{n} → {name}',
        fetch: 'Принести {what} ({have}/{total}) → {name}',
        deconstruct: 'Разобрать: {name} — держите',
        blocked_plant: '{name}: мешает дерево',
        blocked_rock: '{name}: мешает скала',
        blocked_shell: '{name}: место занято',
        blocked_bounds: '{name}: за краем карты',
      },
      err: { busy: 'Занято', noMaterial: 'Нет материалов' },
      tt: {
        blueprint: 'Чертёж: {name}', need: '{what}: {have}/{total}', work: 'Работа: {pct}%', hp: 'Прочность: {hp}/{max}',
        door_open: 'открыта', door_closed: 'закрыта', cost: 'Нужно: {cost}',
      },
      reason: {
        unknown: 'Нельзя', bounds: 'За краем карты', occupied: 'Занято', shell: 'Обшивка поезда', blueprint: 'Уже есть чертёж',
        plant: 'Мешает растение', terrain: 'Здесь нельзя строить', rail: 'На рельсах нельзя', needWagon: 'Только в вагоне',
        needGround: 'Только на земле', same: 'Уже есть такой пол',
      },
      mode: {
        place: '{name}: ЛКМ — поставить{drag} · {rot}ПКМ — отмена',
        drag: ' (тяните линией)',
        dragRect: ' (тяните прямоугольником)',
        rot: '[G] — поворот · ',
        zone: 'Зона склада: ЛКМ — разметить · ПКМ — стереть · [Z]/Esc — выход',
        clear: 'Снос: ЛКМ — снести/отменить (возврат части материалов) · ПКМ — снять пометки · [X]/Esc — выход',
        pick: 'Выберите постройку',
      },
      hint: 'ЛКМ — поставить · [G] — поворот · ПКМ — отмена',
      floor: 'Пол',
      msg: { placed: 'Чертежей: {n}' },
    },
  });
  game.i18n.add('en', {
    build: {
      panel: { title: 'Build' },
      tab: { walls: 'Walls & doors', furniture: 'Furniture', light: 'Light', storage: 'Storage' },
      b: {
        wood_wall: 'Wooden wall', stone_wall: 'Stone wall', door_wood: 'Door', bed: 'Bed', bedroll: 'Bedroll',
        table: 'Table', chair: 'Chair', torch: 'Torch', chest: 'Crate', shelf: 'Shelf',
      },
      key: { rotate: 'Rotate blueprint', zones: 'Stockpile zones', clear: 'Demolish / cancel' },
      job: { deliver: 'hauling materials', construct: 'building', deconstruct: 'deconstructing' },
      des: { deconstruct: 'Deconstruct' },
      zone: { stockpile: 'Stockpile', n: 'Stockpile {n}' },
      filter: { label: 'Filter:', all: 'All', resources: 'Resources', food: 'Food', medicine: 'Medicine' },
      act: {
        construct: 'Build: {name} ({pct}%) — hold',
        give: 'Give {what} ×{n} → {name}',
        fetch: 'Fetch {what} ({have}/{total}) → {name}',
        deconstruct: 'Deconstruct: {name} — hold',
        blocked_plant: '{name}: a tree is in the way',
        blocked_rock: '{name}: a rock is in the way',
        blocked_shell: '{name}: the spot is taken',
        blocked_bounds: '{name}: off the map',
      },
      err: { busy: 'Busy', noMaterial: 'No materials' },
      tt: {
        blueprint: 'Blueprint: {name}', need: '{what}: {have}/{total}', work: 'Work: {pct}%', hp: 'Durability: {hp}/{max}',
        door_open: 'open', door_closed: 'closed', cost: 'Needs: {cost}',
      },
      reason: {
        unknown: 'Not allowed', bounds: 'Off the map', occupied: 'Occupied', shell: 'Train hull', blueprint: 'Blueprint already here',
        plant: 'A plant is in the way', terrain: 'Cannot build here', rail: 'Not on the rails', needWagon: 'Wagons only',
        needGround: 'Ground only', same: 'Same floor already',
      },
      mode: {
        place: '{name}: LMB — place{drag} · {rot}RMB — cancel',
        drag: ' (drag a line)',
        dragRect: ' (drag a rectangle)',
        rot: '[G] — rotate · ',
        zone: 'Stockpile zone: LMB — mark · RMB — erase · [Z]/Esc — exit',
        clear: 'Demolish: LMB — demolish/cancel (part of materials back) · RMB — clear marks · [X]/Esc — exit',
        pick: 'Pick a building',
      },
      hint: 'LMB — place · [G] — rotate · RMB — cancel',
      floor: 'Floor',
      msg: { placed: 'Blueprints: {n}' },
    },
  });
}

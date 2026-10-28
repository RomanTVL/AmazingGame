// Строки модуля train (ru/en).
export function registerStrings(game) {
  game.i18n.add('ru', {
    train: {
      item: { coal: 'Уголь' },
      b: { coal_seam: 'Угольный пласт' },
      wagon: { tender: 'Тендер' },
      scen: {
        three: {
          name: 'Трое выживших',
          desc: 'Маг-проводник и двое уцелевших. Паровоз, тендер, склад и жилой вагон. Угля — перегона на три, еды — дней на десять.',
        },
      },
      act: { horn: '[H] Гудок — посадка' },
      horn: {
        cabOnly: 'Гудок — только из кабины машиниста.',
        boarding: 'Гудок! Посадка — {sec} с. Все к поезду!',
        boardingDone: 'Все на борту.',
        noRoute: 'Дальше пути нет.',
        travelling: 'Поезд уже в пути.',
        cantDepart: 'Сейчас отправиться нельзя.',
        double: 'Двойной гудок — к оружию!',
      },
      depart: {
        title: 'Отправление',
        missing: 'Не сели в поезд ({n}):',
        warn: 'Они останутся на станции навсегда.',
        go: 'Отправляться',
        wait: 'Ждать',
        allAboard: 'Все на борту. Отправляемся!',
      },
      left: {
        one: '{name} остаётся на станции «{station}». Поезд не ждёт.',
        log: 'Оставлен на станции',
      },
      fuel: {
        hud: 'Топливо: {n}',
        legs: '≈ {legs} перег.',
        none: 'Топлива нет!',
        out: 'Топливо кончилось — поезд встаёт.',
        rune: 'Рунный двигатель',
        need: 'на перегон ~{need}',
      },
      board: { job: 'Бежит к поезду' },
      job: { haulFuel: 'Несёт уголь в тендер' },
      hud: { boarding: 'Посадка: {sec} с · не сели: {n}' },
      thought: { left_friend: 'Мы бросили своего' },
    },
  });
  game.i18n.add('en', {
    train: {
      item: { coal: 'Coal' },
      b: { coal_seam: 'Coal seam' },
      wagon: { tender: 'Tender' },
      scen: {
        three: {
          name: 'Three survivors',
          desc: 'A conductor-mage and two survivors. Steam engine, tender, storage and living car. Coal for about three legs, food for about ten days.',
        },
      },
      act: { horn: '[H] Horn — boarding' },
      horn: {
        cabOnly: 'The horn works only from the cab.',
        boarding: 'Horn! Boarding — {sec} s. Everyone to the train!',
        boardingDone: 'Everyone is aboard.',
        noRoute: 'There is no road further.',
        travelling: 'The train is already moving.',
        cantDepart: 'Cannot depart right now.',
        double: 'Double horn — to arms!',
      },
      depart: {
        title: 'Departure',
        missing: 'Not aboard ({n}):',
        warn: 'They will stay at the station forever.',
        go: 'Depart',
        wait: 'Wait',
        allAboard: 'All aboard. Departing!',
      },
      left: {
        one: '{name} stays behind at «{station}». The train does not wait.',
        log: 'Left behind at a station',
      },
      fuel: {
        hud: 'Fuel: {n}',
        legs: '≈ {legs} legs',
        none: 'No fuel!',
        out: 'Out of fuel — the train stops.',
        rune: 'Rune engine',
        need: 'leg needs ~{need}',
      },
      board: { job: 'Running to the train' },
      job: { haulFuel: 'Carrying coal to the tender' },
      hud: { boarding: 'Boarding: {sec} s · missing: {n}' },
      thought: { left_friend: 'We abandoned one of ours' },
    },
  });
}

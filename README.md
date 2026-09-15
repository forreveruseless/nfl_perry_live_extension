# 🏀 NFLPerry NBA Live Assistant — Firefox V8

## Новое: автоматический `Start Game`

Теперь цикл полностью замыкается.

Если после плохой попытки или завершения игры NFLPerry показывает стартовый экран:

```text
HIGH SCORE: 291.4 P/R/A

Start Game
Game Hub
```

расширение само:

1. распознаёт точную кнопку **Start Game**;
2. кликает её;
3. ждёт появления `Draft Pick 1 of 6`;
4. проверяет, что состав пустой;
5. сбрасывает старое состояние попытки;
6. снова проверяет минимальный Potential;
7. если Auto Draft включён — продолжает выбирать игроков.

То есть режим может работать циклом:

```text
Start Game
→ Draft Pick 1
→ Auto Draft
→ Potential ниже минимума
→ restart/reload
→ Start Game
→ Draft Pick 1
→ ...
```

## Когда Auto Start активен

Автоматический `Start Game` используется, когда включено хотя бы одно из:

- Auto Draft;
- Auto Restart после 6/6;
- минимальный Potential / HIGH SCORE threshold.

Если вся автоматизация выключена, расширение само старт игры не нажимает.

## Остальное

Сохранены функции V7:

- POTENTIAL / EXPECTED / 295+;
- минимальный Potential;
- HIGH SCORE как динамический минимум;
- ранний отказ от плохого дроу;
- Auto Restart после 6/6;
- вкладка статистики;
- Top 10 результатов и составы.

## Установка

1. Распакуй ZIP.
2. Firefox → `about:debugging#/runtime/this-firefox`.
3. Удали V7.
4. `Load Temporary Add-on`.
5. Выбери `manifest.json` из папки `nflperry_live_extension_firefox_v8_autostart`.
6. На NFLPerry нажми `Ctrl+F5`.
7. Открой 🏀 и включи нужный автоматический режим.

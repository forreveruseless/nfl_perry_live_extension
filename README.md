# 🦊 NFLPerry NBA Live Assistant — Firefox V4

V4 исправляет две причины, из-за которых V3 могла показывать только кнопку **«Авто»**:

1. база игроков теперь загружается **прямо из content-script**, без зависимости от background messaging Firefox;
2. состав читается не по CSS/DOM-родителям, а по реальному текстовому порядку NFLPerry:

```text
PG
MICHAEL
ADAMS
29.7 P/R/A
(1991)

SG
+ Select SG

...

Draft Pick 2 of 6:
Toronto Raptors
```

## Установка

1. Распакуй ZIP.
2. Firefox → `about:debugging#/runtime/this-firefox`
3. Удали старую временную версию расширения.
4. Нажми **Load Temporary Add-on / Загрузить временное дополнение**.
5. Выбери `manifest.json` из папки `nflperry_live_extension_firefox_v4`.
6. Обнови NFLPerry через `Ctrl+F5`.
7. Нажми 🏀.

## Что должно быть видно сразу

Даже до выбора первого игрока:

- **Potential** должен показать примерно `302.9`;
- список рекомендаций для текущей команды должен заполниться;
- внизу статус должен написать, что база готова.

Если на странице, например:

```text
PG — Michael Adams — 29.7 P/R/A
Draft Pick 2 of 6 — Toronto Raptors
```

панель должна автоматически показать:

```text
PG: Michael Adams / WAS / 29.7
текущая команда: TOR
```

и пересчитать Potential / Expected / 295+.

## PAGE SYNC

По умолчанию включён. Страница NFLPerry является источником истины.

Дополнительная фиксация по клику выключена по умолчанию, чтобы расширение не дублировало твои действия.

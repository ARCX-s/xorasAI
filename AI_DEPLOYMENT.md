# Xoras AI Integration

## Структура

```
├── api/
│   └── ai.js          # Vercel serverless function (прокси для AI)
├── data.js            # API вызовы (теперь на бэкенд)
├── .env.example       # Пример переменных окружения
└── vercel.json        # Vercel конфигурация
```

## Развёртывание

### 1. Настройка переменных окружения

В Vercel Dashboard → Settings → Environment Variables:

```
API_KEY = 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
MODEL = nvidia/nemotron-3-super-120b-a12b:free
```

### 2. Деплой

```bash
npm i -g vercel
vercel --prod
```

Или подключи GitHub репозиторий в Vercel Dashboard.

### 3. Деплой API функции

Функция `/api/ai` автоматически развернётся вместе с приложением.

## Локальная разработка

```bash
# Установка Vercel CLI
npm i -g vercel

# Локальный запуск
vercel dev

# Запуск с переменными окружения
vercel env add API_KEY
vercel dev
```

## Как это работает

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │ ──► │  API Proxy  │ ──► │ OpenRouter │
│  (data.js)  │     │ (api/ai.js)│     │   NVIDIA   │
└─────────────┘     └─────────────┘     └─────────────┘
     └── API ключ скрыт на бэкенде ──┘
```

## Безопасность

- API ключ хранится только на сервере
- Frontend обращается к `/api/ai`, не зная ключа
- Серверная функция валидирует входящие сообщения

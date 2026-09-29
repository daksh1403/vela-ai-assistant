from prometheus_client import Counter, Histogram

HTTP_REQUESTS = Counter("vela_http_requests_total", "HTTP requests", ["route", "method", "status"])
HTTP_LATENCY = Histogram("vela_http_request_duration_seconds", "HTTP latency", ["route", "method"])
AI_REQUESTS = Counter("vela_ai_requests_total", "AI requests", ["operation", "result"])
AI_LATENCY = Histogram("vela_ai_request_duration_seconds", "AI latency", ["operation"])

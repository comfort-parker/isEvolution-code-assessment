.PHONY: up down seed test logs

up:
	docker compose up --build

down:
	docker compose down -v

seed:
	docker compose exec api node src/db/seed.js

test:
	docker compose exec api npm test

logs:
	docker compose logs -f api

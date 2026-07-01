# Vroomon deploy + ops targets.
# None of these targets embed secrets; credentials are pulled from
# ~/.cloudflared, kubectl contexts, and the vroomon-cloudflared-token
# Kubernetes secret. See DEPLOYMENT.md for the full rollout flow.

REGISTRY ?= 127.0.0.1:5000
IMAGE ?= vroomon
TAG ?= $(shell date -u +%Y%m%d-%H%M%S)
IMAGE_REF := $(REGISTRY)/$(IMAGE):$(TAG)

.PHONY: help
help:
	@echo "vroomon deploy targets:"
	@echo "  make guide       Launch the deploy guide web UI (http://localhost:5113)"
	@echo "  make web         Start the web server on :5112 (http://haswell:5112)"
	@echo "  make test        Run vitest"
	@echo "  make build       Build the Docker image"
	@echo "  make push        Build + push the Docker image"
	@echo "  make deploy      Push + apply the k8s manifest"
	@echo "  make redeploy    Apply only (skip rebuild)"
	@echo "  make status      Show pod + service status"
	@echo "  make logs        Tail the vroomon container logs"
	@echo "  make restart     Rollout restart the deployment"
	@echo "  make wipe-state  Delete the PVC (Hall of Fame) and restart"
	@echo ""
	@echo "  IMAGE_REF=$(IMAGE_REF)"

.PHONY: test
test:
	npm test

.PHONY: build
build:
	docker build -t $(IMAGE_REF) -f Dockerfile .

.PHONY: push
push: build
	docker tag $(IMAGE_REF) $(REGISTRY)/$(IMAGE):latest
	docker push $(IMAGE_REF)
	docker push $(REGISTRY)/$(IMAGE):latest

.PHONY: deploy
deploy: push
	kubectl create namespace vroomon --dry-run=client -o yaml | kubectl apply -f -
	kubectl apply -f k8s/vroomon.yaml

.PHONY: redeploy
redeploy:
	kubectl apply -f k8s/vroomon.yaml

.PHONY: status
status:
	kubectl -n vroomon get pods,svc,pvc

.PHONY: logs
logs:
	kubectl -n vroomon logs -l app=vroomon -c vroomon -f

.PHONY: restart
restart:
	kubectl -n vroomon rollout restart deployment/vroomon

.PHONY: guide
guide:
	node scripts/deploy-guide.mjs

.PHONY: web
web:
	node scripts/web-server.mjs

.PHONY: wipe-state
wipe-state:
	kubectl -n vroomon delete pvc vroomon-data --ignore-not-found
	kubectl -n vroomon rollout restart deployment/vroomon

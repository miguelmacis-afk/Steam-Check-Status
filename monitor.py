import os
import json
import requests
from pathlib import Path
from playwright.sync_api import sync_playwright

# Configuración
WEBHOOK_URL = os.getenv("WEBHOOK_URL")  # Lo toma del secret
STATE_FILE = Path("state.json")

def load_previous_state():
    if STATE_FILE.exists():
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    return {}

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)

def send_discord(message):
    if not WEBHOOK_URL:
        print("No se encontró WEBHOOK_URL en el entorno")
        return
    payload = {"content": message}
    response = requests.post(WEBHOOK_URL, json=payload)
    if response.status_code != 204:
        print("Error enviando a Discord:", response.text)

def check_changes(new_state):
    old_state = load_previous_state()
    changes = []
    for key, value in new_state.items():
        if old_state.get(key) != value:
            changes.append(f"**{key}** cambió: {old_state.get(key)} → {value}")
    if changes:
        send_discord("\n".join(changes))
    save_state(new_state)

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("https://steamstat.us/")
        page.wait_for_selector(".services-container")

        new_state = {
            "online": page.query_selector("#online").inner_text(),
            "ingame": page.query_selector("#ingame").inner_text(),
            "store": page.query_selector("#store").inner_text(),
            "community": page.query_selector("#community").inner_text(),
            "webapi": page.query_selector("#webapi").inner_text(),
            "cms": page.query_selector("#cms").inner_text()
        }

        check_changes(new_state)
        browser.close()

if __name__ == "__main__":
    main()

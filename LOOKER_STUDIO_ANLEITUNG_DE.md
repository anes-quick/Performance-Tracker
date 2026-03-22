# Looker Studio – Deutsche Anleitung fürs Analytics-Dashboard

---

## Für Einsteiger: Was ist was?

Du hast noch nie mit Looker Studio gearbeitet – hier die Basics.

### Bericht = dein Dashboard

- Ein **Bericht** ist dein ganzes Dashboard (eine URL, ein „Projekt“).
- Den hast du schon: du hast einen Bericht erstellt und **sheet** als Datenquelle drin.

### Was sind „Seiten“?

- Eine **Seite** in Looker Studio ist wie **ein Bildschirm** oder **ein Tab** in deinem Bericht.
- Du siehst unten oder links oft **„Seite 1“** – das ist deine erste Seite. Alles, was du jetzt einfügst (Zahlen, Tabellen, Diagramme), landet erst mal auf dieser einen Seite.
- **Du musst keine extra Seiten anlegen.** Du kannst alles auf **einer einzigen Seite** bauen: ein paar große Zahlen oben, darunter eine Tabelle, darunter ein Diagramm. Fertig.
- **Seiten** brauchst du nur, wenn du später aufräumen willst: z. B. Seite 1 = „Übersicht“, Seite 2 = „Videos pro Kanal“, Seite 3 = „Quellen-Rankings“. Das ist optional.

**Kurz:** Fang mit **einer Seite** an. Drauf: ein paar Kennzahlen + eine Tabelle. Mehr nicht. Seiten kannst du später dazumachen.

---

## Start: Das Allerwichtigste (nur eine Seite)

Mach das zuerst – dann siehst du sofort was.

### Schritt A: Zwei weitere Datenquellen hinzufügen (falls noch nicht da)

Ohne Datenquelle siehst du keine Daten. Du hast schon **sheet**. Für die Kennzahlen und Videos brauchst du noch:

1. Oben in der Leiste: **Ressourcen** (oder **Resource**) → **Verwaltete Datenquellen** (oder **Manage added data sources**).
2. Klick auf **„Daten hinzufügen“** / **„Add data“**.
3. **Google Tabellen** auswählen.
4. Deine Performance-Tracker-Tabelle auswählen (die mit sheet / videostatsraw / channeldaily).
5. Unten bei **„Blatt auswählen“** / **„Select a sheet“** den Tab **channeldaily** wählen → **Hinzufügen** / **Add**.
6. Nochmal **Daten hinzufügen**: gleiche Tabelle, diesmal Tab **videostatsraw** wählen → **Hinzufügen**.

Jetzt hast du drei Datenquellen: sheet, channeldaily, videostatsraw.

---

### Schritt B: Eine große Zahl (Gesamt-Aufrufe)

1. Oben: **Einfügen** (oder **Insert**) → **Kennzahl** (oder **Scorecard**).
2. Es erscheint eine Box mit einer Zahl (vielleicht 0 oder eine Zufallszahl).
3. **Rechts** öffnet sich eine Leiste. Dort:
   - **Datenquelle** / **Data source**: **channeldaily** wählen.
   - **Metrik** / **Metric**: **total_views** auswählen.
   - Bei **Aggregation** (falls gefragt): **Summe** / **SUM**.
4. Die Box zeigt jetzt die Summe aller Aufrufe aus channeldaily. Fertig.

---

### Schritt C: Eine Tabelle (Videos mit Aufrufen)

1. **Einfügen** → **Tabelle** (**Table**).
2. Rechts in der Leiste:
   - **Datenquelle**: **videostatsraw**.
   - **Dimensionen** / **Dimensions**: Klick **„Dimension hinzufügen“** und nacheinander wählen: **main_channel_name**, **title**, **views** (und wenn du willst **source_id**).
   - **Metrik** / **Metric**: **views** (Summe oder keine Aggregation – je nachdem was Looker anbietet).
3. Die Tabelle zeigt deine Videos: Kanal, Titel, Aufrufe. Fertig.

---

### Schritt D: Ein Diagramm (Aufrufe pro Kanal)

1. **Einfügen** → **Balkendiagramm** (**Bar chart**).
2. Rechts:
   - **Datenquelle**: **videostatsraw**.
   - **Dimension**: **main_channel_name**.
   - **Metrik**: **views** → **Summe**.
3. Du siehst Balken: pro Kanal ein Balken mit Gesamt-Aufrufen.

---

**Das war’s für den Einstieg.** Du hast jetzt **eine Seite** mit: einer Kennzahl (Gesamt-Aufrufe), einer Tabelle (Videos) und einem Balkendiagramm (Aufrufe pro Kanal). Keine weiteren Seiten nötig.

Wenn du willst, kannst du **weitere Seiten** anlegen (z. B. „Übersicht“, „Nach Kanal“, „Quellen“) und die Grafiken darauf verteilen – das steht weiter unten. Aber zum Verstehen reicht erst mal diese eine Seite.

---

## Datenquellen – Übersicht

| Tab in der Tabelle     | Zweck                                      | Wofür im Dashboard                    |
|------------------------|--------------------------------------------|----------------------------------------|
| **sheet**              | Quellen-IDs (Channel, Channel ID, Tracking ID) | Referenz, welche SRC-ID zu welchem Kanal gehört |
| **videostatsraw**      | Video-Daten pro Abruf (Views, Titel, Quelle)  | Video-Statistiken, Kanal-Vergleich, Quellen-Rankings |
| **channeldaily**       | Tageswerte pro Kanal (Views, Abos, Videos)    | Gesamt-Views, Verlauf, Kanal-Übersicht |

**Tipp:** Wenn du **videostatsraw** und **channeldaily** noch nicht als Datenquellen hast: **Ressourcen** → **Verwaltete Datenquellen** → **Daten hinzufügen** → Google Tabellen → dieselbe Tabelle wählen → jeweils einen Tab auswählen (**videostatsraw** bzw. **channeldaily**).

---

## Optional: Weitere Seiten & mehr Grafiken

Die folgenden Abschnitte beschreiben **Seite 1**, **Seite 2**, **Seite 3** – das ist nur eine sinnvolle Aufteilung, wenn du später mehr Ordnung willst.

- **Neue Seite anlegen:** Unten links auf **„Seite hinzufügen“** / **„Add page“** (oder Plus-Symbol), dann der Seite einen Namen geben (z. B. „Übersicht“, „Videos“, „Quellen“).
- Du kannst alle Grafiken auch auf **einer** Seite lassen – wie in „Start: Das Allerwichtigste“ oben.

---

## 1. Seite: Übersicht (Kennzahlen & Verlauf)

### 1.1 Gesamt-Aufrufe (alle Kanäle)

1. **Einfügen** → **Kennzahl** (oder Scorecard).
2. Rechts in der Leiste **Datenquelle** wählen: **channeldaily** (oder wie du den Tab genannt hast).
3. **Metrik:** **total_views** → Aggregation **Summe** (SUM).
4. Optional: **Filter** hinzufügen, z. B. nur letzte 7 Tage (über Datumsbereich).

**Anzeige:** Eine große Zahl = Summe aller Aufrufe über alle Kanäle (aus den Tages-Snapshots).

---

### 1.2 Gesamt-Abonnenten

1. Noch eine **Kennzahl** einfügen.
2. Datenquelle: **channeldaily**.
3. **Metrik:** **total_subscribers** → **Summe** (oder **Max**, wenn du pro Kanal nur den letzten Wert willst).

---

### 1.3 Aufrufe im Zeitverlauf (Linien- oder Balkendiagramm)

1. **Einfügen** → **Zeitseriendiagramm** (Time series chart).
2. Datenquelle: **channeldaily**.
3. **Dimension:** **date** (Datum).
4. **Metrik:** **total_views** → **Summe**.
5. Optional **Aufschlüsselung:** **channel_name** → dann siehst du eine Linie pro Kanal.

**Anzeige:** Verlauf der Aufrufe pro Tag (oder pro Kanal).

---

### 1.4 Optional: Filter für Datumsbereich

1. **Einfügen** → **Steuerelemente** → **Datumsbereich**.
2. Datenquelle: **channeldaily**, Feld **date** zuordnen.
3. Dann gelten alle Charts mit dieser Datenquelle für den gewählten Zeitraum.

---

## 2. Seite: Nach Kanal (Videos & Aufrufe)

Erstelle eine **neue Seite** (z. B. „Nach Kanal“ oder „Videos“).

### 2.1 Tabelle: Letzte Videos mit Aufrufen

1. **Einfügen** → **Tabelle**.
2. Datenquelle: **videostatsraw**.
3. **Dimensionen** (Spalten):
   - **main_channel_name** (Kanal)
   - **title** (Titel)
   - **published_at** (Veröffentlichung)
   - **views** (Aufrufe)
   - **source_id** (Quellen-ID, sobald du sie in den Beschreibungen nutzt)
   - **source_channel_name** (Quellen-Kanalname)
4. **Metrik:** z. B. **views** (Summe oder Durchschnitt, je nach Darstellung).
5. **Sortierung:** z. B. nach **published_at** oder **views** absteigend.

**Hinweis:** Ohne Source-ID in den YouTube-Beschreibungen bleiben **source_id** und **source_channel_name** oft leer – die Spalten füllen sich, sobald der Workflow läuft.

---

### 2.2 Balkendiagramm: Aufrufe pro Kanal

1. **Einfügen** → **Balkendiagramm**.
2. Datenquelle: **videostatsraw**.
3. **Dimension:** **main_channel_name**.
4. **Metrik:** **views** → **Summe** (Summe der Aufrufe pro Kanal).

**Anzeige:** Welcher Kanal in den erfassten Daten die meisten Aufrufe hat.

---

### 2.3 Filter: Ein Kanal auswählen

1. **Einfügen** → **Steuerelemente** → **Filter** (Liste/Dropdown).
2. Datenquelle: **videostatsraw**.
3. **Steuerungsfeld:** **main_channel_name**.
4. Wenn du den Filter mit der Tabelle verknüpfen willst: Tabelle markieren → rechts **Interaktion** → „Filter beeinflussen“ aktivieren und die Tabelle auswählen (oder umgekehrt: Filter steuert die Seite).

Dann kannst du z. B. nur CrazyMomente oder nur Nunito anzeigen.

---

## 3. Seite: Quellen-Performance (sobald Source-IDs genutzt werden)

Diese Seite lohnt sich, sobald du die Quellen-ID in die YouTube-Beschreibung kopierst und der Scraper die Felder **source_id** und **source_channel_name** füllt.

### 3.1 Tabelle: Top-Quellen nach Gesamt-Aufrufen

1. **Einfügen** → **Tabelle**.
2. Datenquelle: **videostatsraw**.
3. **Dimension:** **source_channel_name** (oder **source_id**).
4. **Metrik:** **views** → **Summe**.
5. **Sortierung:** Nach Aufrufen absteigend.
6. **Filter:** Nur Zeilen mit ausgefüllter Quellen-ID:
   - Datenquelle **videostatsraw** → Filter hinzufügen → Bedingung: **source_id** **ist nicht leer** (oder „not null“ / „not blank“, je nach Looker-Formulierung).

**Anzeige:** Welche Quellen-Kanäle insgesamt die meisten Aufrufe gebracht haben.

---

### 3.2 Tabelle: Top-Quellen nach durchschnittlichen Aufrufen pro Video

1. Weitere **Tabelle**.
2. Datenquelle: **videostatsraw**.
3. **Dimension:** **source_channel_name**.
4. **Metriken:**
   - **views** → **Durchschnitt** (AVG)
   - **video_id** → **Anzahl** (COUNT), um zu sehen, wie viele Videos pro Quelle
5. Gleicher Filter: **source_id** ist nicht leer.
6. Sortierung nach Durchschnitt Aufrufe absteigend.

**Anzeige:** Quellen mit dem besten Durchschnitt pro Video (nicht nur Gesamt-Views).

---

### 3.3 Optional: Nische als Filter

1. **Steuerelement** → Filter.
2. Feld: **niche** (commentary, scary, dance).
3. So kannst du z. B. nur Commentary- oder nur Dance-Quellen anzeigen.

---

## 4. Kurz-Checkliste

- [ ] Datenquelle **channeldaily** hinzugefügt (falls noch nicht).
- [ ] Datenquelle **videostatsraw** hinzugefügt (falls noch nicht).
- [ ] Seite 1: Kennzahlen (Gesamt-Views, Abos) + Zeitserie (Views über Zeit).
- [ ] Seite 2: Tabelle Videos + Balken „Views pro Kanal“ + Kanal-Filter.
- [ ] Seite 3: Tabellen für Quellen-Rankings (mit Filter „source_id nicht leer“).
- [ ] Optional: Datumsbereich und Nischen-Filter.

---

## 5. Wichtige Hinweise

- **Aktualisierung:** Looker Studio liest die Daten beim Öffnen bzw. Aktualisieren des Berichts aus der Tabelle. Kein separates „Speichern“ der Tabelle nötig – Scraper schreibt weiter wie gewohnt.
- **Leere Quellen-Felder:** Solange du die Source-ID noch nicht in die YouTube-Beschreibung einfügst, bleiben **source_id** und **source_channel_name** oft leer. Die Quellen-Charts füllen sich, sobald der Workflow steht.
- **Nur ein Tab pro Datenquelle:** Du kannst nicht „die ganze Tabelle“ auf einmal verbinden. Pro Datenquelle einen Tab (sheet, videostatsraw, channeldaily) – das ist genau so gewollt und reicht für alle beschriebenen Analysen.

Wenn du magst, können wir als Nächstes eine konkrete Reihenfolge für deinen Bericht machen (z. B. zuerst nur Übersicht + eine Tabelle) oder einzelne Schritte noch genauer auf deine deutschen Feldnamen zuschneiden.

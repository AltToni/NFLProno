# Ecarts de score en saison reguliere NFL

Genere par `scripts/analyse-ecarts.ts` sur les saisons **2015-2025**, soit **2895 matchs** joues jusqu'au bout.

Le seau `30` regroupe tous les ecarts de 30 points ou plus : pris un par un, ils sont trop rares pour porter une frequence stable.


## Constante de calibration

`k = 0.037724`, choisi pour que le bonus moyen — pondere par la frequence reelle des ecarts — vaille **100.00 %**.

Bonus d'un ecart exact : `clamp(k / f(m), 25.00 %, 200.00 %)`. Plus l'ecart vise est improbable, plus il rapporte.


## Table

| Ecart | Matchs | f(m) | Bonus si exact |
|---|---:|---:|---:|
| 0 (nul) | 10 | 0.35 % | +200 % |
| 1 | 132 | 4.56 % | +83 % |
| 2 | 134 | 4.63 % | +82 % |
| 3 | 424 | 14.65 % | +26 % |
| 4 | 136 | 4.70 % | +80 % |
| 5 | 127 | 4.39 % | +86 % |
| 6 | 201 | 6.94 % | +54 % |
| 7 | 251 | 8.67 % | +44 % |
| 8 | 125 | 4.32 % | +87 % |
| 9 | 50 | 1.73 % | +200 % |
| 10 | 141 | 4.87 % | +77 % |
| 11 | 61 | 2.11 % | +179 % |
| 12 | 53 | 1.83 % | +200 % |
| 13 | 58 | 2.00 % | +188 % |
| 14 | 148 | 5.11 % | +74 % |
| 15 | 50 | 1.73 % | +200 % |
| 16 | 67 | 2.31 % | +163 % |
| 17 | 100 | 3.45 % | +109 % |
| 18 | 63 | 2.18 % | +173 % |
| 19 | 33 | 1.14 % | +200 % |
| 20 | 59 | 2.04 % | +185 % |
| 21 | 64 | 2.21 % | +171 % |
| 22 | 29 | 1.00 % | +200 % |
| 23 | 38 | 1.31 % | +200 % |
| 24 | 55 | 1.90 % | +199 % |
| 25 | 34 | 1.17 % | +200 % |
| 26 | 30 | 1.04 % | +200 % |
| 27 | 23 | 0.79 % | +200 % |
| 28 | 45 | 1.55 % | +200 % |
| 29 | 15 | 0.52 % | +200 % |
| 30+ | 139 | 4.80 % | +79 % |

## Lecture

- L'ecart le plus courant est **3** (14.65 % des matchs), qui rapporte le bonus le plus faible : **+26 %**.
- Le plus rare des ecarts jouables est **0** (0.35 %), a **+200 %**.
- 12 ecart(s) atteignent le plafond de 200.00 % : 0, 9, 12, 15, 19, 22, 23, 25, 26, 27, 28, 29.

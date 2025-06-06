# HeySprecht - Plateforme d'apprentissage de l'allemand par la vidéo

## Vue d'ensemble

HeySprecht est une plateforme innovante d'apprentissage de l'allemand qui utilise des vidéos comme support principal d'apprentissage. Le système combine la compréhension audiovisuelle, le vocabulaire contextualisé et des exercices interactifs pour créer une expérience d'apprentissage immersive.

## Processus d'apprentissage

### 1. Apprentissage par vidéo

#### Phase de visionnage
- Les utilisateurs peuvent regarder des vidéos en allemand
- Les vidéos sont catégorisées par niveau de difficulté (débutant, intermédiaire, avancé)
- Chaque vidéo est accompagnée de sous-titres en allemand et en français
- Le système suit automatiquement la progression du visionnage

#### Segmentation intelligente
- Les vidéos sont découpées en segments courts pour faciliter l'apprentissage
- Chaque segment contient des mots clés identifiés
- Les utilisateurs peuvent revoir des segments spécifiques

### 2. Acquisition du vocabulaire

#### Extraction contextuelle
- Les mots importants sont extraits automatiquement des vidéos
- Chaque mot est présenté dans son contexte d'utilisation
- Les traductions sont fournies avec des exemples

#### Système de révision espacée
- Les mots appris sont intégrés à un système de révision intelligente
- Les intervalles de révision s'adaptent au niveau de maîtrise
- 5 niveaux de maîtrise pour chaque mot :
  * Niveau 1 : Révision après 1 jour
  * Niveau 2 : Révision après 3 jours
  * Niveau 3 : Révision après 1 semaine
  * Niveau 4 : Révision après 2 semaines
  * Niveau 5 : Révision après 1 mois

### 3. Exercices et évaluation

#### Types d'exercices
- Exercices de traduction (allemand vers français et inversement)
- Questions de compréhension sur les segments vidéo
- Exercices de prononciation

#### Système de progression
- Gain de points d'expérience (XP) pour chaque activité complétée
- Niveaux débloqués progressivement
- Suivi des séries d'apprentissage quotidiennes (streaks)

### 4. Suivi de la progression

#### Tableau de bord personnel
- Vue d'ensemble du niveau actuel et des XP
- Statistiques de visionnage des vidéos
- Historique des exercices complétés
- Progrès du vocabulaire

#### Indicateurs de performance
- Taux de réussite aux exercices
- Nombre de mots maîtrisés
- Temps d'apprentissage quotidien
- Séries d'apprentissage maintenues

## Architecture technique

### Base de données
- Suivi des progrès utilisateur (table `user_progress`)
- Historique des exercices (`exercise_completions`)
- Gestion du vocabulaire personnalisé (`user_vocabulary`)
- Progression des vidéos (`video_progress`)

### API RESTful
- Endpoints pour la progression de l'apprentissage
- Gestion des exercices et des résultats
- Suivi du vocabulaire et des révisions
- Gestion de la progression vidéo

### Fonctionnalités de gamification
- Système de points d'expérience
- Niveaux progressifs
- Séries d'apprentissage quotidiennes
- Badges et récompenses

## Bonnes pratiques d'utilisation

### Pour un apprentissage optimal
1. Maintenir une routine quotidienne
2. Utiliser activement le système de révision
3. Combiner visionnage et exercices
4. Noter les mots difficiles pour révision

### Recommandations de progression
1. Commencer par des vidéos courtes de niveau débutant
2. Augmenter progressivement la difficulté
3. Réviser régulièrement le vocabulaire
4. Pratiquer quotidiennement pour maintenir les séries

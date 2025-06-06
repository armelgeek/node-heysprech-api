import { and, eq, isNull, lte, or } from 'drizzle-orm'
import { db } from '../../infrastructure/database/db'
import {
  exerciseCompletions,
  userProgress,
  userVocabulary,
  videoExercises,
  videoProgress,
  videoSegments,
  videoWords
} from '../../infrastructure/database/schema'

export class LearningProgressService {
  private calculateNextReview(masteryLevel: number): Date {
    const now = new Date()
    switch (masteryLevel) {
      case 1:
        return new Date(now.getTime() + 24 * 60 * 60 * 1000) // +1 jour
      case 2:
        return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) // +3 jours
      case 3:
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // +1 semaine
      case 4:
        return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) // +2 semaines
      case 5:
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) // +1 mois
      default:
        return new Date(now.getTime() + 24 * 60 * 60 * 1000) // +1 jour par défaut
    }
  }

  private async updateVideoStats(userId: string, videoId: number): Promise<void> {
    await db.transaction(async (tx) => {
      const exerciseStats = await tx.query.exerciseCompletions.findMany({
        where: and(eq(exerciseCompletions.userId, userId), eq(exerciseCompletions.videoId, videoId))
      })

      const vocabularyProgress = await tx.query.userVocabulary.findMany({
        where: and(eq(userVocabulary.userId, userId), eq(userVocabulary.videoId, videoId))
      })

      await tx
        .update(videoProgress)
        .set({
          completedExercises: exerciseStats.length,
          masteredWords: vocabularyProgress.filter((v) => v.masteryLevel >= 4).length,
          updatedAt: new Date()
        })
        .where(and(eq(videoProgress.userId, userId), eq(videoProgress.videoId, videoId)))
    })
  }

  // Progression globale
  async getUserProgress(userId: string) {
    return await db.query.userProgress.findFirst({
      where: eq(userProgress.userId, userId)
    })
  }

  async updateUserXP(userId: string, xpToAdd: number) {
    const currentProgress = await this.getUserProgress(userId)
    if (!currentProgress) {
      return await db.insert(userProgress).values({
        userId,
        totalXp: xpToAdd,
        level: Math.floor(xpToAdd / 1000) + 1
      })
    }

    return await db
      .update(userProgress)
      .set({
        totalXp: currentProgress.totalXp + xpToAdd,
        level: Math.floor((currentProgress.totalXp + xpToAdd) / 1000) + 1,
        updatedAt: new Date()
      })
      .where(eq(userProgress.userId, userId))
  }

  async updateUserVocabulary(userId: string, wordId: number, videoId: number, masteryLevel: number) {
    const existingEntry = await db.query.userVocabulary.findFirst({
      where: and(
        eq(userVocabulary.userId, userId),
        eq(userVocabulary.wordId, wordId),
        eq(userVocabulary.videoId, videoId)
      )
    })

    if (!existingEntry) {
      return await db.insert(userVocabulary).values({
        userId,
        wordId,
        videoId,
        masteryLevel,
        nextReview: this.calculateNextReview(masteryLevel),
        lastReviewed: new Date()
      })
    } else {
      const updated = await db
        .update(userVocabulary)
        .set({
          masteryLevel,
          nextReview: this.calculateNextReview(masteryLevel),
          lastReviewed: new Date(),
          updatedAt: new Date()
        })
        .where(eq(userVocabulary.id, existingEntry.id))
      await this.updateVideoStats(userId, videoId)
      return updated
    }
  }

  // Gestion des exercices
  async saveVideoExerciseCompletion(
    userId: string,
    exerciseId: number,
    videoId: number,
    score: number,
    isCorrect: boolean
  ) {
    const completion = await db.insert(exerciseCompletions).values({
      userId,
      exerciseId,
      videoId,
      score,
      isCorrect
    })

    await this.updateVideoStats(userId, videoId)
    return completion
  }

  async getVideoExerciseHistory(userId: string, videoId: number) {
    return await db.query.exerciseCompletions.findMany({
      where: and(eq(exerciseCompletions.userId, userId), eq(exerciseCompletions.videoId, videoId)),
      orderBy: (exerciseCompletions, { desc }) => [desc(exerciseCompletions.completedAt)]
    })
  }

  // Vocabulaire
  async updateVideoVocabularyMastery(userId: string, wordId: number, videoId: number, masteryLevel: number) {
    const existingEntry = await db.query.userVocabulary.findFirst({
      where: and(
        eq(userVocabulary.userId, userId),
        eq(userVocabulary.wordId, wordId),
        eq(userVocabulary.videoId, videoId)
      )
    })

    if (!existingEntry) {
      return await db.insert(userVocabulary).values({
        userId,
        wordId,
        videoId,
        masteryLevel,
        nextReview: this.calculateNextReview(masteryLevel),
        lastReviewed: new Date()
      })
    }

    const updated = await db
      .update(userVocabulary)
      .set({
        masteryLevel,
        nextReview: this.calculateNextReview(masteryLevel),
        lastReviewed: new Date(),
        updatedAt: new Date()
      })
      .where(eq(userVocabulary.id, existingEntry.id))

    await this.updateVideoStats(userId, videoId)
    return updated
  }

  async getVideoWordsForReview(userId: string): Promise<any[]> {
    // Get all words that need review (past their next review date or no review date set)
    return await db.query.userVocabulary.findMany({
      where: and(
        eq(userVocabulary.userId, userId), 
        or(lte(userVocabulary.nextReview, new Date()), isNull(userVocabulary.nextReview))
      ),
      with: {
        word: true
      },
      orderBy: (userVoc, { asc }) => [asc(userVoc.nextReview)]
    })
  }

  // Segments de vidéo
  async getVideoSegments(videoId: number) {
    return await db.query.videoSegments.findMany({
      where: eq(videoSegments.videoId, videoId),
      orderBy: (segments, { asc }) => [asc(segments.startTime)]
    })
  }

  async getSegmentDetails(segmentId: number) {
    const segment = await db.query.videoSegments.findFirst({
      where: eq(videoSegments.id, segmentId)
    })

    if (!segment) return null

    const words = await db.query.videoWords.findMany({
      where: eq(videoWords.segmentId, segmentId)
    })

    const exercises = await db.query.videoExercises.findMany({
      where: eq(videoExercises.segmentId, segmentId)
    })

    return { segment, words, exercises }
  }

  // Progression vidéo
  async updateVideoProgress(userId: string, videoId: number, watchedSeconds: number, lastSegmentId?: number) {
    const existingProgress = await db.query.videoProgress.findFirst({
      where: and(eq(videoProgress.userId, userId), eq(videoProgress.videoId, videoId))
    })

    if (!existingProgress) {
      return await db.insert(videoProgress).values({
        userId,
        videoId,
        watchedSeconds,
        lastSegmentWatched: lastSegmentId,
        isCompleted: false
      })
    }

    return await db
      .update(videoProgress)
      .set({
        watchedSeconds,
        lastSegmentWatched: lastSegmentId,
        lastWatched: new Date(),
        updatedAt: new Date()
      })
      .where(eq(videoProgress.id, existingProgress.id))
  }

  async markVideoCompleted(userId: string, videoId: number) {
    const existingProgress = await db.query.videoProgress.findFirst({
      where: and(eq(videoProgress.userId, userId), eq(videoProgress.videoId, videoId))
    })

    if (!existingProgress) {
      return await db.insert(videoProgress).values({
        userId,
        videoId,
        isCompleted: true
      })
    }

    return await db
      .update(videoProgress)
      .set({
        isCompleted: true,
        lastWatched: new Date(),
        updatedAt: new Date()
      })
      .where(eq(videoProgress.id, existingProgress.id))
  }

  async getVideoStats(userId: string, videoId: number) {
    const progress = await db.query.videoProgress.findFirst({
      where: and(eq(videoProgress.userId, userId), eq(videoProgress.videoId, videoId))
    })

    const exerciseStats = await db.query.exerciseCompletions.findMany({
      where: and(eq(exerciseCompletions.userId, userId), eq(exerciseCompletions.videoId, videoId))
    })

    const vocabularyProgress = await db.query.userVocabulary.findMany({
      where: and(eq(userVocabulary.userId, userId), eq(userVocabulary.videoId, videoId))
    })

    return {
      watchingProgress: {
        watchedSeconds: progress?.watchedSeconds || 0,
        isCompleted: progress?.isCompleted || false,
        lastWatched: progress?.lastWatched
      },
      exerciseProgress: {
        totalExercises: exerciseStats.length,
        correctExercises: exerciseStats.filter((ex) => ex.isCorrect).length,
        averageScore: exerciseStats.reduce((acc, ex) => acc + ex.score, 0) / (exerciseStats.length || 1)
      },
      vocabularyProgress: {
        totalWords: vocabularyProgress.length,
        masteredWords: vocabularyProgress.filter((v) => v.masteryLevel >= 4).length,
        inProgressWords: vocabularyProgress.filter((v) => v.masteryLevel > 0 && v.masteryLevel < 4).length,
        newWords: vocabularyProgress.filter((v) => v.masteryLevel === 0).length
      }
    }
  }

  async getVideoLearningStatus(userId: string, videoId: number) {
    const userProgress = await db.transaction(async (tx) => {
      const exercises = await tx.query.exerciseCompletions.findMany({
        where: and(eq(exerciseCompletions.userId, userId), eq(exerciseCompletions.videoId, videoId))
      })

      const vocab = await tx.query.userVocabulary.findMany({
        where: and(eq(userVocabulary.userId, userId), eq(userVocabulary.videoId, videoId))
      })

      const segments = await tx.query.videoSegments.findMany({
        where: eq(videoSegments.videoId, videoId)
      })

      const progress = segments.length > 0 ? (exercises.length / segments.length) * 100 : 0

      return {
        completedExercises: exercises.length,
        masteredWords: vocab.filter((v) => v.masteryLevel >= 4).length,
        totalSegments: segments.length,
        progress: Math.round(progress),
        lastActivity: exercises.length > 0 ? exercises.at(-1)?.completedAt?.toISOString() : undefined
      }
    })

    return userProgress
  }

  async completeVideoSegment(userId: string, videoId: number, segmentId: number) {
    await db.transaction(async (tx) => {
      // Mark segment exercises as completed
      const segmentExercises = await tx.query.videoExercises.findMany({
        where: eq(videoExercises.segmentId, segmentId)
      })

      for (const exercise of segmentExercises) {
        await tx.insert(exerciseCompletions).values({
          userId,
          exerciseId: exercise.id,
          videoId,
          score: 0,
          isCorrect: true,
          completedAt: new Date()
        })
      }

      // Update progress for words in this segment
      const segmentWords = await tx.query.videoWords.findMany({
        where: eq(videoWords.segmentId, segmentId)
      })

      for (const word of segmentWords) {
        const existingProgress = await tx.query.userVocabulary.findFirst({
          where: and(eq(userVocabulary.userId, userId), eq(userVocabulary.wordId, word.id))
        })

        if (existingProgress) {
          await tx
            .update(userVocabulary)
            .set({
              masteryLevel: Math.min(existingProgress.masteryLevel + 1, 5),
              nextReview: this.calculateNextReview(existingProgress.masteryLevel + 1),
              lastReviewed: new Date()
            })
            .where(eq(userVocabulary.id, existingProgress.id))
        } else {
          await tx.insert(userVocabulary).values({
            userId,
            wordId: word.id,
            videoId,
            masteryLevel: 1,
            nextReview: this.calculateNextReview(1),
            lastReviewed: new Date()
          })
        }
      }

      // Add XP for completing the segment
      await this.updateUserXP(userId, 50)
    })
  }

  async updateVocabularyMastery(userId: string, wordId: number, masteryLevel: number): Promise<void> {
    const wordEntries = await db.query.userVocabulary.findMany({
      where: and(eq(userVocabulary.userId, userId), eq(userVocabulary.wordId, wordId))
    })

    // Update mastery level for the word across all videos where it appears
    await Promise.all(
      wordEntries.map((entry) => 
        this.updateVideoVocabularyMastery(userId, wordId, entry.videoId, masteryLevel)
      )
    )
  }

  async saveExerciseCompletion(
    userId: string,
    exerciseId: number,
    score: number,
    isCorrect: boolean,
    timeTaken?: number
  ): Promise<void> {
    await db.transaction(async (tx) => {
      // Get the exercise and its associated video
      const exercise = await tx.query.videoExercises.findFirst({
        where: eq(videoExercises.id, exerciseId)
      })

      if (!exercise) {
        throw new Error(`Exercise with ID ${exerciseId} not found`)
      }

      const videoId = exercise.videoId

      // Record the exercise completion
      await tx.insert(exerciseCompletions).values({
        userId,
        exerciseId,
        videoId,
        score,
        isCorrect,
        completedAt: new Date()
      })

      // Update video progress stats
      await this.updateVideoStats(userId, videoId)

      // Calculate and award XP based on performance
      const xpEarned = this.calculateExerciseXP(score, isCorrect, timeTaken)
      await this.updateUserXP(userId, xpEarned)
    })
  }

  private calculateExerciseXP(score: number, isCorrect: boolean, timeTaken?: number): number {
    let xp = 0

    // Base XP for completion
    xp += 10

    // Bonus XP for correct answer
    if (isCorrect) {
      xp += 20
    }

    // Bonus XP for high score
    if (score > 80) {
      xp += 15
    } else if (score > 60) {
      xp += 10
    }

    // Speed bonus if completed quickly
    if (timeTaken !== undefined && timeTaken < 30) {
      xp += 5
    }

    return xp
  }
}

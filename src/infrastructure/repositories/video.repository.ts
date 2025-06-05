import { promises as fs } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { VideoModel, type Video } from '@/domain/models/video.model'
import { ExerciseDataSchema, PronunciationSchema } from '@/domain/types/exercise.types'
import type { VideoRepositoryInterface, VideoSegment } from '@/domain/repositories/video.repository.interface'
import { db } from '../database/db'
import {
  exerciseOptions,
  exerciseQuestions,
  exercises,
  pronunciations,
  wordEntries
} from '../database/schema/exercise.schema'
import { audioSegments, processingLogs, videos, wordSegments } from '../database/schema/video.schema'
import { BaseRepository } from './base.repository'
import type { PgTransaction } from 'drizzle-orm/pg-core'

interface ExerciseOption {
  id: number
  text: string
  isCorrect: boolean
}

interface ExerciseQuestion {
  id: number
  direction: 'de_to_fr' | 'fr_to_de'
  questionDe: string
  questionFr: string
  wordToTranslate: string
  correctAnswer: string
  options: ExerciseOption[]
}

interface Exercise {
  id: number
  type: string
  level: string
  questions: ExerciseQuestion[]
}

export class VideoRepository extends BaseRepository<typeof videos> implements VideoRepositoryInterface {
  constructor() {
    super(videos)
  }

  private validateTime(time: unknown): number {
    const num = Number(time)
    return Number.isNaN(num) ? 0 : Math.floor(num * 1000)
  }

  private validateScore(score: unknown): number {
    const num = Number(score)
    return Number.isNaN(num) ? 0 : Math.floor(num * 1000)
  }

  async insertVideo(videoData: Omit<Video, 'id'>): Promise<number> {
    const [result] = await db
      .insert(videos)
      .values({
        title: videoData.title,
        originalFilename: videoData.originalFilename,
        filePath: videoData.filePath,
        fileSize: videoData.fileSize,
        language: videoData.language || 'de',
        transcriptionStatus: 'pending',
        tempInfoFile: videoData.tempInfoFile
      })
      .returning({ id: videos.id })

    return result.id
  }

  async updateVideoStatus(
    videoId: number,
    status: Video['transcriptionStatus'],
    data?: {
      jobId?: string
      errorMessage?: string
      transcriptionFile?: string
    }
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      transcriptionStatus: status,
      updatedAt: new Date()
    }

    if (data?.jobId) {
      updateData.queueJobId = data.jobId
    }
    if (data?.errorMessage) {
      updateData.errorMessage = data.errorMessage
    }
    if (data?.transcriptionFile) {
      updateData.transcriptionFile = data.transcriptionFile
    }
    if (status === 'completed') {
      updateData.processedAt = new Date()
    }

    await db.update(videos).set(updateData).where(eq(videos.id, videoId))
  }

  async logProcessingStep(
    videoId: number,
    step: string,
    status: 'started' | 'completed' | 'failed',
    message: string | null = null
  ): Promise<void> {
    await db.insert(processingLogs).values({
      videoId,
      step,
      status,
      message: message || undefined
    })
  }

  async getVideoById(id: number): Promise<VideoModel | null> {
    const [result] = await db.select().from(videos).where(eq(videos.id, id)).limit(1)

    return result ? new VideoModel(this.mapVideoFromDb(result)) : null
  }

  async getRecentVideos(limit: number = 20): Promise<VideoModel[]> {
    const results = await db
      .select({
        video: videos,
        segments: audioSegments,
        words: wordSegments,
        wordEntry: wordEntries,
        exercise: exercises,
        exerciseQuestion: exerciseQuestions,
        exerciseOption: exerciseOptions,
        pronunciation: pronunciations
      })
      .from(videos)
      .leftJoin(audioSegments, eq(videos.id, audioSegments.videoId))
      .leftJoin(wordSegments, eq(audioSegments.id, wordSegments.audioSegmentId))
      .leftJoin(wordEntries, eq(wordSegments.word, wordEntries.word))
      .leftJoin(exercises, eq(wordEntries.id, exercises.wordId))
      .leftJoin(exerciseQuestions, eq(exercises.id, exerciseQuestions.exerciseId))
      .leftJoin(exerciseOptions, eq(exerciseQuestions.id, exerciseQuestions.id))
      .leftJoin(pronunciations, eq(wordEntries.id, pronunciations.wordId))
      .orderBy(sql`${videos.createdAt} DESC`)
      .limit(limit)

    // Regrouper les résultats par vidéo
    const videoMap = new Map()

    for (const row of results) {
      if (!videoMap.has(row.video.id)) {
        videoMap.set(row.video.id, {
          ...this.mapVideoFromDb(row.video),
          segments: [],
          vocabulary: new Map()
        })
      }

      const videoData = videoMap.get(row.video.id)

      // Ajouter le segment s'il n'existe pas déjà
      if (row.segments && !videoData.segments.some((s: { id: number }) => s.id === row.segments!.id)) {
        videoData.segments.push({
          id: row.segments.id,
          startTime: row.segments.startTime / 1000,
          endTime: row.segments.endTime / 1000,
          text: row.segments.text,
          translation: row.segments.translation,
          language: row.segments.language,
          words: []
        })
      }

      // Ajouter le mot au segment et au vocabulaire
      if (row.words) {
        const rowWords = row.words
        // Ajouter au segment correspondant
        const segment = videoData.segments.find((s: { id: number }) => s.id === rowWords.audioSegmentId)
        if (segment && !segment.words.some((w: { word: string }) => w.word === rowWords.word)) {
          segment.words.push({
            word: row.words.word,
            startTime: row.words.startTime / 1000,
            endTime: row.words.endTime / 1000,
            confidenceScore: row.words.confidenceScore / 1000
          })
        }

        // Ajouter au vocabulaire global
        if (!videoData.vocabulary.has(row.words.word)) {
          videoData.vocabulary.set(row.words.word, {
            occurrences: [],
            confidenceScoreAvg: 0,
            metadata: row.wordEntry?.metadata ?? null,
            translations: row.wordEntry?.translations ?? [],
            examples: row.wordEntry?.examples ?? [],
            level: row.wordEntry?.level ?? 'intermediate',
            exercises: [],
            pronunciations: []
          })
        }

        const wordData = videoData.vocabulary.get(row.words.word)

        // Ajouter l'occurrence
        wordData.occurrences.push({
          segmentId: row.words.audioSegmentId,
          startTime: row.words.startTime / 1000,
          endTime: row.words.endTime / 1000,
          confidenceScore: row.words.confidenceScore / 1000
        })

        // Ajouter l'exercice s'il n'existe pas déjà et qu'il existe
        if (row.exercise?.id && !wordData.exercises.some((ex: { id: number }) => ex.id === row.exercise!.id)) {
          const exercise: Exercise = {
            id: row.exercise.id,
            type: row.exercise.type,
            level: row.exercise.level,
            questions: []
          }

          // Ajouter la question si elle existe
          if (row.exerciseQuestion?.id) {
            const question: ExerciseQuestion = {
              id: row.exerciseQuestion.id,
              direction: row.exerciseQuestion.direction as 'de_to_fr' | 'fr_to_de',
              questionDe: row.exerciseQuestion.questionDe,
              questionFr: row.exerciseQuestion.questionFr,
              wordToTranslate: row.exerciseQuestion.wordToTranslate,
              correctAnswer: row.exerciseQuestion.correctAnswer,
              options: []
            }

            // Ajouter l'option si elle existe
            if (row.exerciseOption?.id) {
              question.options.push({
                id: row.exerciseOption.id,
                text: row.exerciseOption.optionText,
                isCorrect: row.exerciseOption.isCorrect
              })
            }

            exercise.questions.push(question)
          }

          wordData.exercises.push(exercise)
        }

        // Ajouter la prononciation si elle n'existe pas déjà et qu'elle existe
        if (
          row.pronunciation?.id &&
          !wordData.pronunciations.some((p: { id: number }) => p.id === row.pronunciation!.id)
        ) {
          wordData.pronunciations.push({
            id: row.pronunciation.id,
            filePath: row.pronunciation.filePath,
            type: row.pronunciation.type,
            language: row.pronunciation.language
          })
        }
      }
    }

    return Array.from(videoMap.values()).map((videoData) => {
      const vocabulary = Array.from(videoData.vocabulary.entries() as [string, any][])
        .map(([word, data]) => ({
          word,
          occurrences: data.occurrences,
          confidenceScoreAvg:
            data.occurrences.reduce((acc: number, curr: { confidenceScore: number }) => acc + curr.confidenceScore, 0) /
            data.occurrences.length,
          metadata: data.metadata,
          translations: Array.isArray(data.translations) ? data.translations : [],
          examples: Array.isArray(data.examples) ? data.examples : [],
          level: data.level,
          exercises: ExerciseDataSchema.parse(data.exercises),
          pronunciations: (data.pronunciations || []).map((p: any) => ({
            file: p.filePath,
            type: p.type,
            language: p.language
          }))
        }))
        .sort((a, b) => b.confidenceScoreAvg - a.confidenceScoreAvg)

      return new VideoModel({
        ...videoData,
        vocabulary
      })
    })
  }

  async deleteVideo(id: number): Promise<void> {
    await db.delete(videos).where(eq(videos.id, id))
  }

  async insertAudioSegments(segments: VideoSegment[], videoId: number, language: string): Promise<number[]> {
    const audioSegmentIds: number[] = []

    await db.transaction(async (tx) => {
      for (const segment of segments) {
        const [audioSegment] = await tx
          .insert(audioSegments)
          .values({
            videoId,
            startTime: this.validateTime(segment.startTime),
            endTime: this.validateTime(segment.endTime),
            text: segment.text || '',
            language,
            translation: segment.translation
          })
          .returning({ id: audioSegments.id })

        const audioSegmentId = audioSegment.id
        audioSegmentIds.push(audioSegmentId)

        if (segment.words && segment.words.length > 0) {
          const wordValues = segment.words.map((word, index) => ({
            audioSegmentId,
            word: word.word || '',
            startTime: this.validateTime(word.startTime),
            endTime: this.validateTime(word.endTime),
            confidenceScore: this.validateScore(word.confidenceScore),
            positionInSegment: index + 1
          }))

          await tx.insert(wordSegments).values(wordValues)
        }
      }
    })

    return audioSegmentIds
  }

  async loadTranscriptionData(
    videoId: number,
    transcriptionFile: string
  ): Promise<{
    segments: number
    vocabulary: number
    language: string
  }> {
    try {
      console.info(`📖 [Video ${videoId}] Lecture du fichier de transcription...`)
      const fileContent = await fs.readFile(transcriptionFile, 'utf8')
      const jsonData = JSON.parse(fileContent)
      console.info(`✅ [Video ${videoId}] Fichier JSON parsé avec succès`)

      let segmentsInserted = 0
      let vocabularyInserted = 0

      console.info(`📊 [Video ${videoId}] Analyse du contenu...`)

      await db.transaction(async (tx) => {
        // Insertion des segments audio
        if (Array.isArray(jsonData.segments)) {
          console.info(`🔄 [Video ${videoId}] Importation de ${jsonData.segments.length} segments audio...`)
          await this.insertAudioSegments(jsonData.segments, videoId, jsonData.language || 'de')
          segmentsInserted = jsonData.segments.length
          console.info(`✅ [Video ${videoId}] Segments audio importés avec succès`)
        }

        // Traitement du vocabulaire et des exercices
        if (Array.isArray(jsonData.vocabulary)) {
          console.info(`🔤 [Video ${videoId}] Traitement du vocabulaire (${jsonData.vocabulary.length} mots)...`)

          for (const word of jsonData.vocabulary) {
            // Insérer le mot dans la table wordEntries
            const [wordEntry] = await tx
              .insert(wordEntries)
              .values({
                word: word.word,
                language: word.metadata?.source_language || 'de',
                translations: word.translations,
                examples: word.examples,
                level: word.level || 'intermediate',
                metadata: word.metadata
              })
              .returning({ id: wordEntries.id })

            // Traitement des exercices
            if (word.exercises) {
              console.info(`📝 [Video ${videoId}] Traitement des exercices pour le mot ${word.word}...`)
              await this.insertExercisesTx(tx, word.exercises, wordEntry.id)
            }

            // Traitement des prononciations
            if (Array.isArray(word.pronunciations)) {
              console.info(`🔊 [Video ${videoId}] Ajout des prononciations pour le mot ${word.word}...`)
              const validatedPronunciations = word.pronunciations.map((p: unknown) => PronunciationSchema.parse(p))
              const pronunciationValues = validatedPronunciations.map((p: { file: any; type: any; language: any }) => ({
                wordId: wordEntry.id,
                filePath: p.file,
                type: p.type,
                language: p.language
              }))
              await tx.insert(pronunciations).values(pronunciationValues)
            }
          }

          vocabularyInserted = jsonData.vocabulary.length
          console.info(`✅ [Video ${videoId}] Vocabulaire traité avec succès`)
        }
      })

      const result = {
        segments: segmentsInserted,
        vocabulary: vocabularyInserted,
        language: jsonData.language || 'de'
      }

      console.info(`📊 [Video ${videoId}] Résumé de l'importation:
        - Segments audio: ${result.segments}
        - Mots de vocabulaire: ${result.vocabulary}
        - Langue: ${result.language}`)

      return result
    } catch (error) {
      throw new TypeError(`Erreur lors du chargement de la transcription: ${(error as Error).message}`)
    }
  }

  private async insertExercisesTx(
    tx: PgTransaction<any, any, any>,
    exercisesData: unknown,
    wordId: number
  ): Promise<void> {
    try {
      const result = ExerciseDataSchema.safeParse(exercisesData)
      if (!result.success) {
        throw new TypeError(`Données d'exercice invalides: ${result.error.message}`)
      }
      const validatedData = result.data

      // Créer l'exercice
      const [exercise] = await tx
        .insert(exercises)
        .values({
          wordId,
          type: validatedData.type,
          level: validatedData.level
        })
        .returning({ id: exercises.id })

      // Traitement des questions DE -> FR
      if (validatedData.de_to_fr) {
        const [question] = await tx
          .insert(exerciseQuestions)
          .values({
            exerciseId: exercise.id,
            direction: 'de_to_fr',
            questionDe: validatedData.de_to_fr.question.de,
            questionFr: validatedData.de_to_fr.question.fr,
            wordToTranslate: validatedData.de_to_fr.word_to_translate,
            correctAnswer: validatedData.de_to_fr.correct_answer
          })
          .returning({ id: exerciseQuestions.id })

        // Ajout des options
        const options = validatedData.de_to_fr.options.map((option) => ({
          questionId: question.id,
          optionText: option,
          isCorrect: option === validatedData.de_to_fr.correct_answer
        }))
        await tx.insert(exerciseOptions).values(options)
      }

      // Traitement des questions FR -> DE
      if (validatedData.fr_to_de) {
        const [question] = await tx
          .insert(exerciseQuestions)
          .values({
            exerciseId: exercise.id,
            direction: 'fr_to_de',
            questionDe: validatedData.fr_to_de.question.de,
            questionFr: validatedData.fr_to_de.question.fr,
            wordToTranslate: validatedData.fr_to_de.word_to_translate,
            correctAnswer: validatedData.fr_to_de.correct_answer
          })
          .returning({ id: exerciseQuestions.id })

        // Ajout des options
        const options = validatedData.fr_to_de.options.map((option) => ({
          questionId: question.id,
          optionText: option,
          isCorrect: option === validatedData.fr_to_de.correct_answer
        }))
        await tx.insert(exerciseOptions).values(options)
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new TypeError(`Données d'exercice invalides: ${error.message}`)
      }
      throw error
    }
  }

  private mapVideoFromDb(dbVideo: typeof videos.$inferSelect): Video {
    return {
      id: dbVideo.id,
      title: dbVideo.title,
      originalFilename: dbVideo.originalFilename,
      filePath: dbVideo.filePath,
      fileSize: dbVideo.fileSize || 0,
      language: dbVideo.language,
      transcriptionStatus: dbVideo.transcriptionStatus ?? 'pending',
      queueJobId: dbVideo.queueJobId || undefined,
      errorMessage: dbVideo.errorMessage || undefined,
      tempInfoFile: dbVideo.tempInfoFile || undefined,
      transcriptionFile: dbVideo.transcriptionFile || undefined,
      createdAt: dbVideo.createdAt || undefined,
      updatedAt: dbVideo.updatedAt || undefined,
      processedAt: dbVideo.processedAt || undefined
    }
  }

  async insertExercises(exercises: z.infer<typeof ExerciseDataSchema>[], word: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Trouver l'ID du mot
      const [wordEntry] = await tx
        .select({ id: wordEntries.id })
        .from(wordEntries)
        .where(eq(wordEntries.word, word))
        .limit(1)

      if (!wordEntry) {
        throw new Error(`Word not found: ${word}`)
      }

      await this.insertExercisesTx(tx, exercises, wordEntry.id)
    })
  }

  async insertPronunciations(pronunciationData: z.infer<typeof PronunciationSchema>[], word: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Trouver l'ID du mot
      const [wordEntry] = await tx
        .select({ id: wordEntries.id })
        .from(wordEntries)
        .where(eq(wordEntries.word, word))
        .limit(1)

      if (!wordEntry) {
        throw new Error(`Word not found: ${word}`)
      }

      const validatedPronunciations = pronunciationData.map((p) => PronunciationSchema.parse(p))
      const pronunciationValues = validatedPronunciations.map((p) => ({
        wordId: wordEntry.id,
        filePath: p.file,
        type: p.type,
        language: p.language
      }))

      await tx.insert(pronunciations).values(pronunciationValues)
    })
  }
}

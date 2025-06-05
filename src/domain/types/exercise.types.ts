import { z } from 'zod'

// Schema for exercise question data
export const ExerciseQuestionSchema = z.object({
  question: z.object({
    de: z.string(),
    fr: z.string()
  }),
  word_to_translate: z.string(),
  correct_answer: z.string(),
  options: z.array(z.string())
})

// Schema for exercise data
export const ExerciseDataSchema = z.object({
  type: z.literal('multiple_choice_pair'),
  level: z.enum(['beginner', 'intermediate', 'advanced']).default('intermediate'),
  de_to_fr: ExerciseQuestionSchema,
  fr_to_de: ExerciseQuestionSchema
})

// Schema for pronunciation data
export const PronunciationSchema = z.object({
  file: z.string(),
  type: z.string(),
  language: z.string()
})

// Schema for vocabulary item data
export const VocabularyEntrySchema = z.object({
  occurrences: z.array(
    z.object({
      segmentId: z.number(),
      startTime: z.number(),
      endTime: z.number(),
      confidenceScore: z.number()
    })
  ),
  metadata: z.any(),
  translations: z.array(z.string()),
  examples: z.array(z.string()),
  level: z.string(),
  exercises: z.array(
    z.object({
      id: z.number(),
      type: z.string(),
      level: z.string(),
      questions: z.array(
        z.object({
          id: z.number(),
          direction: z.enum(['de_to_fr', 'fr_to_de']),
          questionDe: z.string(),
          questionFr: z.string(),
          wordToTranslate: z.string(),
          correctAnswer: z.string(),
          options: z.array(
            z.object({
              id: z.number(),
              optionText: z.string(),
              isCorrect: z.boolean()
            })
          )
        })
      )
    })
  ),
  pronunciations: z.array(
    z.object({
      id: z.number(),
      filePath: z.string(),
      type: z.string(),
      language: z.string()
    })
  )
})

export type ExerciseQuestion = z.infer<typeof ExerciseQuestionSchema>
export type ExerciseData = z.infer<typeof ExerciseDataSchema>
export type PronunciationData = {
  file: string
  type: string
  language: string
}
export type VocabularyEntry = z.infer<typeof VocabularyEntrySchema>

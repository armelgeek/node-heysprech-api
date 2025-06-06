import { integer, pgEnum, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'

export const transcriptionStatusEnum = pgEnum('transcription_status', ['pending', 'processing', 'completed', 'failed'])

export const processingStatusEnum = pgEnum('processing_status', ['started', 'completed', 'failed'])

export const videos = pgTable('videos', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 500 }).notNull(),
  originalFilename: varchar('original_filename', { length: 500 }).notNull(),
  filePath: varchar('file_path', { length: 1000 }).notNull(),
  fileSize: integer('file_size'),
  duration: integer('duration'),
  language: varchar('language', { length: 10 }).notNull().default('de'),
  transcriptionStatus: transcriptionStatusEnum('transcription_status').default('pending'),
  queueJobId: varchar('queue_job_id', { length: 255 }),
  errorMessage: text('error_message'),
  youtubeId: varchar('youtube_id', { length: 11 }),
  tempInfoFile: varchar('temp_info_file', { length: 1000 }),
  transcriptionFile: varchar('transcription_file', { length: 1000 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  processedAt: timestamp('processed_at')
})

export const processingLogs = pgTable('processing_logs', {
  id: serial('id').primaryKey(),
  videoId: integer('video_id')
    .notNull()
    .references(() => videos.id, { onDelete: 'cascade' }),
  step: varchar('step', { length: 100 }).notNull(),
  status: processingStatusEnum('status').notNull(),
  message: text('message'),
  createdAt: timestamp('created_at').defaultNow()
})

export const audioSegments = pgTable('audio_segments', {
  id: serial('id').primaryKey(),
  videoId: integer('video_id')
    .notNull()
    .references(() => videos.id, { onDelete: 'cascade' }),
  startTime: integer('start_time').notNull(),
  endTime: integer('end_time').notNull(),
  text: text('text').notNull(),
  language: varchar('language', { length: 10 }).notNull(),
  translation: text('translation'),
  createdAt: timestamp('created_at').defaultNow()
})

export const wordSegments = pgTable('word_segments', {
  id: serial('id').primaryKey(),
  audioSegmentId: integer('audio_segment_id')
    .notNull()
    .references(() => audioSegments.id, { onDelete: 'cascade' }),
  word: varchar('word', { length: 255 }).notNull(),
  startTime: integer('start_time').notNull(),
  endTime: integer('end_time').notNull(),
  confidenceScore: integer('confidence_score').notNull(),
  positionInSegment: integer('position_in_segment').notNull()
})

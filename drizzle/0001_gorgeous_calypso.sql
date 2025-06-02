CREATE TYPE "public"."processing_status" AS ENUM('started', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."transcription_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "audio_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer NOT NULL,
	"start_time" integer NOT NULL,
	"end_time" integer NOT NULL,
	"text" text NOT NULL,
	"language" varchar(10) NOT NULL,
	"translation" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "processing_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer NOT NULL,
	"step" varchar(100) NOT NULL,
	"status" "processing_status" NOT NULL,
	"message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(500) NOT NULL,
	"original_filename" varchar(500) NOT NULL,
	"file_path" varchar(1000) NOT NULL,
	"file_size" integer,
	"duration" integer,
	"language" varchar(10) DEFAULT 'de' NOT NULL,
	"transcription_status" "transcription_status" DEFAULT 'pending',
	"queue_job_id" varchar(255),
	"error_message" text,
	"temp_info_file" varchar(1000),
	"transcription_file" varchar(1000),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "word_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"audio_segment_id" integer NOT NULL,
	"word" varchar(255) NOT NULL,
	"start_time" integer NOT NULL,
	"end_time" integer NOT NULL,
	"confidence_score" integer NOT NULL,
	"position_in_segment" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_segments" ADD CONSTRAINT "audio_segments_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_logs" ADD CONSTRAINT "processing_logs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_segments" ADD CONSTRAINT "word_segments_audio_segment_id_audio_segments_id_fk" FOREIGN KEY ("audio_segment_id") REFERENCES "public"."audio_segments"("id") ON DELETE cascade ON UPDATE no action;
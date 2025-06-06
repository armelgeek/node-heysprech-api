import { Hono } from 'hono'

export const Home = new Hono()

export const Meteors = ({ number }: { number: number }) => {
  return (
    <>
      {Array.from({ length: number || 20 }, (_, idx) => (
        <span
          key={idx}
          class="meteor animate-[meteorAnimation_3s_linear_infinite] absolute h-1 w-1 rounded-[9999px] shadow-[0_0_0_1px_#ffffff10] rotate-[215deg]"
          style={{
            top: 0,
            left: `${Math.floor(Math.random() * (400 - -400) + -400)}px`,
            animationDelay: `${Math.random() * (0.8 - 0.2) + 0.2}s`,
            animationDuration: `${Math.floor(Math.random() * (10 - 2) + 2)}s`
          }}
        />
      ))}
    </>
  )
}

Home.get('/', (c) => {
  const title = 'Sprech API Documentation'
  const description = 'Explore our comprehensive API documentation for audio processing and transcription services.'

  return c.html(
    <html>
      <head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charset="utf-8" />
        <meta name="description" content={description} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:title" content={title} />
        <meta property="twitter:description" content={description} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Lexend:wght@100..900&family=Outfit:wght@100..900&display=swap"
          rel="stylesheet"
        />
        <script src="https://cdn.tailwindcss.com" />
        <style
          dangerouslySetInnerHTML={{
            __html: `
            * { font-family: 'Lexend', sans-serif; } 
            @keyframes borderAnimation {
              0%, 100% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
            }
            @keyframes meteorAnimation {
              0% { transform: rotate(215deg) translateX(0); opacity: 1; }
              70% { opacity: 1; }
              100% { transform: rotate(215deg) translateX(-500px); opacity: 0; }
            }
            .meteor::before {
              content: '';
              position: absolute;
              top: 50%;
              transform: translateY(-50%);
              width: 50px;
              height: 1px;
              background: linear-gradient(90deg, #64748b, transparent);
            }
            .animate-meteor-effect {
              animation-name: meteorAnimation;
            }`
          }}
        />
      </head>
      <body class="min-h-screen bg-black overflow-x-hidden flex flex-col">
        <main class="flex-1 flex flex-col justify-center items-center p-4 sm:p-8 relative">
          <div class="max-w-2xl w-full bg-white bg-opacity-5 rounded-lg p-8 backdrop-blur-sm">
            <div class="text-center mb-8">
              <span class="text-xs uppercase bg-purple-500 bg-opacity-15 rounded px-2 py-1 font-bold tracking-wide text-purple-500">
                Sprech API
              </span>
              <h1 class="mt-4 text-neutral-200 font-bold text-3xl sm:text-4xl">Audio Processing API</h1>
              <p class="mt-2 text-neutral-500">{description}</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <a
                href="/docs"
                class="group p-4 bg-white bg-opacity-5 rounded-lg transition-all hover:bg-opacity-10 border border-transparent hover:border-purple-500"
              >
                <div class="flex flex-col gap-2">
                  <span class="text-purple-500 font-semibold">📚 Documentation</span>
                  <span class="text-neutral-500 text-sm">Explore our comprehensive API documentation</span>
                </div>
              </a>

              <a
                href="/api/auth/reference"
                class="group p-4 bg-white bg-opacity-5 rounded-lg transition-all hover:bg-opacity-10 border border-transparent hover:border-purple-500"
              >
                <div class="flex flex-col gap-2">
                  <span class="text-purple-500 font-semibold">🔑 Authentication</span>
                  <span class="text-neutral-500 text-sm">Learn how to authenticate your API requests</span>
                </div>
              </a>
            </div>
          </div>
        </main>
        <Meteors number={20} />
      </body>
    </html>
  )
})

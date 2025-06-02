# Base en utilisant bun:1.2.8
FROM oven/bun:1.2.8 
WORKDIR /usr/src/app

# Copie des fichiers pour l'installation
COPY package.json ./

# Installation des dépendances
RUN bun install

# Copie le reste des fichiers
COPY . .
RUN cp .env.local .env

# Créer les dossiers d'upload
RUN mkdir -p uploads/avatars && chmod -R 755 uploads

# Migration
#RUN bun run db:push || echo "Update database Schema"

# Expose le port de l'app
EXPOSE 3000

# Demarrer l'app en mode dev
#CMD [ "bun", "run", "dev" ]
CMD ["sh", "-c", "bun run db:push && bun run build && bun run prod"]


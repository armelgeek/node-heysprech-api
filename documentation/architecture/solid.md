# Principes SOLID dans BoilerHono Backend

Les principes SOLID sont fondamentaux dans notre architecture. Voici comment nous les appliquons dans notre projet.

## S - Single Responsibility Principle (SRP) 📌

**Principe**: Une classe ne devrait avoir qu'une seule raison de changer.

### Exemple dans notre code:

\`\`\`typescript
// UserRepository a une seule responsabilité : la gestion des données utilisateur
export class UserRepository implements UserRepositoryInterface {
    findById(id: string): Promise<User>
    save(user: User): Promise<User>
    // ...
}

// UserService orchestre les opérations liées aux utilisateurs
export class UserService {
    getUserById(args: GetUserByIdArgs): Promise<User>
    // ...
}

// AuthMiddleware ne gère que l'authentification
export const protect = async (c: Context, next: Next) => {
    // Logique d'authentification uniquement
}
\`\`\`

## O - Open/Closed Principle (OCP) 🚪

**Principe**: Les entités logicielles doivent être ouvertes à l'extension, mais fermées à la modification.

### Exemple dans notre code:

\`\`\`typescript
// Interface de base pour tous les cas d'utilisation
export abstract class IUseCase<T extends Obj = any, TRes = any> {
    abstract execute(params: T): Promise<TRes>
    abstract log(): ActivityType
}

// Extension sans modification
export class GetUserByIdUseCase extends IUseCase<GetUserByIdArgs, User> {
    execute({ userId }: GetUserByIdArgs): Promise<User> {
        // Implémentation spécifique
    }
    
    log(): ActivityType {
        return ActivityType.GET_USER
    }
}
\`\`\`

## L - Liskov Substitution Principle (LSP) 🔄

**Principe**: Les objets d'une classe dérivée doivent pouvoir remplacer les objets de la classe de base sans altérer le comportement du programme.

### Exemple dans notre code:

\`\`\`typescript
// Interface de base pour les repositories
export interface UserRepositoryInterface {
    findById(id: string): Promise<User | null>
    findAll(): Promise<User[]>
    save(user: User): Promise<User>
    remove(id: string): Promise<boolean>
}

// Implémentation en mémoire
export class InMemoryUserRepository implements UserRepositoryInterface {
    // Implémentation complète respectant le contrat
}

// Implémentation avec base de données
export class DrizzleUserRepository implements UserRepositoryInterface {
    // Implémentation complète respectant le contrat
}

// Les deux implémentations sont interchangeables
const userService = new UserService(
    Bun.env.NODE_ENV === 'test' 
        ? new InMemoryUserRepository()
        : new DrizzleUserRepository()
)
\`\`\`

## I - Interface Segregation Principle (ISP) 🔍

**Principe**: Les clients ne devraient pas être forcés de dépendre d'interfaces qu'ils n'utilisent pas.

### Exemple dans notre code:

\`\`\`typescript
// Interface séparée pour l'authentification
interface AuthenticationRepository {
    validateCredentials(email: string, password: string): Promise<boolean>
    createSession(userId: string): Promise<Session>
}

// Interface séparée pour la gestion des utilisateurs
interface UserManagementRepository {
    updateProfile(userId: string, data: ProfileData): Promise<User>
    changePassword(userId: string, newPassword: string): Promise<void>
}

// Une classe peut implémenter une ou plusieurs interfaces selon ses besoins
export class UserRepository implements UserManagementRepository {
    // Implémente uniquement les méthodes de gestion des utilisateurs
}

export class AuthRepository implements AuthenticationRepository {
    // Implémente uniquement les méthodes d'authentification
}
\`\`\`

## D - Dependency Inversion Principle (DIP) 🔀

**Principe**: Les modules de haut niveau ne devraient pas dépendre des modules de bas niveau. Les deux devraient dépendre d'abstractions.

### Exemple dans notre code:

\`\`\`typescript
// Abstraction (interface)
interface EmailService {
    sendEmail(to: string, subject: string, content: string): Promise<void>
}

// Module de haut niveau dépend de l'abstraction
export class UserService {
    constructor(
        private readonly userRepository: UserRepositoryInterface,
        private readonly emailService: EmailService
    ) {}

    async createUser(userData: UserData): Promise<User> {
        const user = await this.userRepository.save(userData)
        await this.emailService.sendEmail(
            user.email,
            'Bienvenue',
            'Bienvenue surBoilerHono!'
        )
        return user
    }
}

// Implémentation concrète (module de bas niveau)
export class SmtpEmailService implements EmailService {
    async sendEmail(to: string, subject: string, content: string): Promise<void> {
        // Implémentation SMTP
    }
}
\`\`\`

## Application dans notre architecture 🏗️

Notre architecture hexagonale facilite naturellement l'application des principes SOLID :

1. **Domain Layer** : Contient les interfaces et les modèles purs
2. **Application Layer** : Implémente les cas d'utilisation en respectant SRP
3. **Infrastructure Layer** : Fournit les implémentations concrètes

### Bénéfices

- ✅ **Maintenabilité** : Code plus facile à maintenir et à modifier
- ✅ **Testabilité** : Composants facilement testables grâce aux interfaces
- ✅ **Flexibilité** : Facile d'ajouter ou de modifier des fonctionnalités
- ✅ **Réutilisabilité** : Composants découplés et réutilisables
- ✅ **Évolutivité** : Architecture qui supporte bien la croissance

## Bonnes pratiques d'implémentation 📝

1. **Utiliser les interfaces**
   - Définir des contrats clairs
   - Favoriser le découplage
   - Faciliter les tests

2. **Injection de dépendances**
   - Construire les objets à l'extérieur
   - Passer les dépendances via le constructeur
   - Utiliser un container IoC si nécessaire

3. **Tests**
   - Tester chaque composant isolément
   - Utiliser des mocks pour les dépendances
   - Vérifier le respect des contrats

## Validation et maintenance ✔️

Pour s'assurer du respect des principes SOLID :

1. **Code Review**
   - Vérifier la responsabilité unique
   - Contrôler les dépendances
   - Valider les interfaces

2. **Tests**
   - Tests unitaires
   - Tests d'intégration
   - Tests de contrat

3. **Documentation**
   - Documenter les interfaces
   - Expliquer les responsabilités
   - Maintenir les exemples
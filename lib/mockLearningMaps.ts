export type ResourceType = "video" | "article" | "documentation" | "practice";

export type LearningStep = {
  id: string;
  title: string;
  type: ResourceType;
  link: string;
  description: string;
  x: number;
  y: number;
};

export type LearningRoute = {
  id: string;
  name: string;
  averageRating: number;
  ratingCount: number;
  pathColor: string;
  pathD: string;
  popularityHint: string;
  steps: LearningStep[];
};

export type FieldLearningMap = {
  fieldId: string;
  fieldTitle: string;
  subtitle: string;
  routes: LearningRoute[];
  palace: {
    x: number;
    y: number;
    label: string;
  };
};

export const mockLearningMaps: Record<string, FieldLearningMap> = {
  "web-dev": {
    fieldId: "web-dev",
    fieldTitle: "Web Development",
    subtitle: "Find your path to mastery.",
    palace: { x: 86, y: 17, label: "Mastery Milestone" },
    routes: [
      {
        id: "web-a",
        name: "Route A: Frontend Road",
        averageRating: 4.8,
        ratingCount: 128,
        pathColor: "#58CC02",
        pathD: "M 8 82 C 18 72, 30 65, 38 58 C 48 50, 56 45, 66 40 C 74 35, 80 27, 86 17",
        popularityHint: "Popular among explorers who love visual building.",
        steps: [
          {
            id: "web-a-1",
            title: "HTML Foundations",
            type: "video",
            link: "https://developer.mozilla.org/en-US/docs/Learn/HTML/Introduction_to_HTML",
            description: "Learn the structure of webpages with semantic HTML.",
            x: 12,
            y: 79,
          },
          {
            id: "web-a-2",
            title: "CSS Layout Adventure",
            type: "article",
            link: "https://css-tricks.com/snippets/css/a-guide-to-flexbox/",
            description: "Practice layout systems with Flexbox and responsive rules.",
            x: 34,
            y: 61,
          },
          {
            id: "web-a-3",
            title: "React Components Quest",
            type: "documentation",
            link: "https://react.dev/learn/your-first-component",
            description: "Build reusable components and understand props/state.",
            x: 58,
            y: 45,
          },
          {
            id: "web-a-4",
            title: "Next.js Routing Practice",
            type: "practice",
            link: "https://nextjs.org/docs/app/building-your-application/routing",
            description: "Implement nested routes and page navigation patterns.",
            x: 76,
            y: 30,
          },
        ],
      },
      {
        id: "web-b",
        name: "Route B: Backend Road",
        averageRating: 4.6,
        ratingCount: 94,
        pathColor: "#FFD84D",
        pathD: "M 14 88 C 24 80, 31 74, 36 67 C 42 60, 51 56, 60 56 C 71 55, 80 35, 86 17",
        popularityHint: "Great for explorers preparing full-stack projects.",
        steps: [
          {
            id: "web-b-1",
            title: "Node.js Basics",
            type: "video",
            link: "https://nodejs.dev/en/learn/",
            description: "Understand runtime concepts, modules, and scripts.",
            x: 17,
            y: 84,
          },
          {
            id: "web-b-2",
            title: "REST API Design",
            type: "article",
            link: "https://restfulapi.net/",
            description: "Learn endpoints, resources, and status code strategy.",
            x: 37,
            y: 67,
          },
          {
            id: "web-b-3",
            title: "Database Schema Setup",
            type: "documentation",
            link: "https://www.prisma.io/docs/orm/prisma-schema/overview",
            description: "Create practical schema models for real features.",
            x: 60,
            y: 56,
          },
          {
            id: "web-b-4",
            title: "Authentication Drill",
            type: "practice",
            link: "https://next-auth.js.org/getting-started/introduction",
            description: "Implement sign-in flows and protected routes.",
            x: 75,
            y: 39,
          },
        ],
      },
      {
        id: "web-c",
        name: "Route C: Project Road",
        averageRating: 4.7,
        ratingCount: 73,
        pathColor: "#6FB92C",
        pathD: "M 10 72 C 25 74, 30 62, 40 52 C 52 40, 64 32, 74 29 C 79 27, 84 23, 86 17",
        popularityHint: "Perfect for explorers who learn by shipping projects.",
        steps: [
          {
            id: "web-c-1",
            title: "UI Planning Sketch",
            type: "article",
            link: "https://www.nngroup.com/articles/wireframing-basics/",
            description: "Plan layout and user flows before coding.",
            x: 14,
            y: 72,
          },
          {
            id: "web-c-2",
            title: "Build a Landing Page",
            type: "practice",
            link: "https://tailwindcss.com/docs/installation",
            description: "Create a polished and responsive first page.",
            x: 38,
            y: 53,
          },
          {
            id: "web-c-3",
            title: "Add App State",
            type: "documentation",
            link: "https://react.dev/learn/managing-state",
            description: "Manage local and shared state across components.",
            x: 62,
            y: 36,
          },
          {
            id: "web-c-4",
            title: "Deploy to the Cloud",
            type: "video",
            link: "https://vercel.com/docs/deployments/overview",
            description: "Ship your app and monitor deployment updates.",
            x: 77,
            y: 25,
          },
        ],
      },
    ],
  },
  ielts: {
    fieldId: "ielts",
    fieldTitle: "IELTS",
    subtitle: "Small steps build strong skills.",
    palace: { x: 86, y: 17, label: "Mastery Milestone" },
    routes: [
      {
        id: "ielts-a",
        name: "Route A: Speaking Road",
        averageRating: 4.7,
        ratingCount: 112,
        pathColor: "#58CC02",
        pathD: "M 12 84 C 24 76, 30 66, 39 60 C 51 52, 58 42, 67 37 C 76 31, 82 25, 86 17",
        popularityHint: "Ideal for explorers aiming for confident speaking.",
        steps: [
          {
            id: "ielts-a-1",
            title: "Part 1 Speaking Warmup",
            type: "video",
            link: "https://takeielts.britishcouncil.org/take-ielts/prepare/free-ielts-english-practice-tests/speaking",
            description: "Practice short personal answers with confidence.",
            x: 14,
            y: 81,
          },
          {
            id: "ielts-a-2",
            title: "Cue Card Strategy",
            type: "article",
            link: "https://ieltsliz.com/ielts-speaking-free-lessons-essential-tips/",
            description: "Structure your Part 2 talk quickly and clearly.",
            x: 38,
            y: 60,
          },
          {
            id: "ielts-a-3",
            title: "Fluency Practice Pack",
            type: "practice",
            link: "https://www.cambridgeenglish.org/exams-and-tests/ielts/preparation/",
            description: "Boost fluency with timed speaking simulations.",
            x: 64,
            y: 40,
          },
          {
            id: "ielts-a-4",
            title: "Band 7 Speaking Checklist",
            type: "documentation",
            link: "https://ielts.org/take-a-test/preparation-resources",
            description: "Review criteria and polish your speaking delivery.",
            x: 78,
            y: 27,
          },
        ],
      },
      {
        id: "ielts-b",
        name: "Route B: Reading Road",
        averageRating: 4.5,
        ratingCount: 85,
        pathColor: "#FFD84D",
        pathD: "M 10 88 C 22 84, 32 76, 42 70 C 54 62, 64 56, 70 44 C 75 36, 81 28, 86 17",
        popularityHint: "Great for explorers improving scanning and timing.",
        steps: [
          {
            id: "ielts-b-1",
            title: "Skimming Techniques",
            type: "article",
            link: "https://takeielts.britishcouncil.org/take-ielts/prepare/free-ielts-english-practice-tests/reading",
            description: "Find main ideas quickly in long passages.",
            x: 16,
            y: 86,
          },
          {
            id: "ielts-b-2",
            title: "Question Type Drills",
            type: "practice",
            link: "https://ieltsliz.com/ielts-reading/",
            description: "Train matching headings and true/false/not given.",
            x: 42,
            y: 70,
          },
          {
            id: "ielts-b-3",
            title: "Timed Mock Reading",
            type: "practice",
            link: "https://www.ielts.org/for-test-takers/sample-test-questions",
            description: "Practice full sections under exam timing constraints.",
            x: 68,
            y: 48,
          },
          {
            id: "ielts-b-4",
            title: "Accuracy Review",
            type: "documentation",
            link: "https://ielts.org/take-a-test/preparation-resources",
            description: "Analyze errors and improve score reliability.",
            x: 79,
            y: 31,
          },
        ],
      },
      {
        id: "ielts-c",
        name: "Route C: Writing Road",
        averageRating: 4.6,
        ratingCount: 97,
        pathColor: "#6FB92C",
        pathD: "M 8 76 C 18 70, 28 58, 38 54 C 50 48, 60 34, 69 30 C 77 26, 82 22, 86 17",
        popularityHint: "Strong route for explorers targeting writing band gains.",
        steps: [
          {
            id: "ielts-c-1",
            title: "Task 1 Structure",
            type: "video",
            link: "https://ieltsliz.com/ielts-writing-task-1-lessons-and-tips/",
            description: "Write clear overviews and data comparisons.",
            x: 12,
            y: 75,
          },
          {
            id: "ielts-c-2",
            title: "Task 2 Essay Planning",
            type: "article",
            link: "https://www.britishcouncil.org/school-resources/find/lesson-plan-ielts-writing-task-2",
            description: "Plan arguments with coherence and depth.",
            x: 36,
            y: 54,
          },
          {
            id: "ielts-c-3",
            title: "Grammar Accuracy Drill",
            type: "practice",
            link: "https://learnenglish.britishcouncil.org/grammar",
            description: "Reduce mistakes through targeted grammar training.",
            x: 61,
            y: 36,
          },
          {
            id: "ielts-c-4",
            title: "Band Descriptor Self-check",
            type: "documentation",
            link: "https://ielts.org/for-organisations/ielts-scoring-in-detail",
            description: "Assess writing against official scoring standards.",
            x: 77,
            y: 24,
          },
        ],
      },
    ],
  },
  ml: {
    fieldId: "ml",
    fieldTitle: "Machine Learning",
    subtitle: "Choose a path and keep your progress moving.",
    palace: { x: 86, y: 17, label: "Mastery Milestone" },
    routes: [
      {
        id: "ml-a",
        name: "Route A: Foundations Road",
        averageRating: 4.9,
        ratingCount: 143,
        pathColor: "#58CC02",
        pathD: "M 12 84 C 24 74, 32 66, 42 60 C 54 53, 63 45, 70 37 C 77 30, 82 24, 86 17",
        popularityHint: "The most popular road for first-time ML explorers.",
        steps: [
          {
            id: "ml-a-1",
            title: "Math for ML Refresher",
            type: "video",
            link: "https://www.khanacademy.org/math/linear-algebra",
            description: "Refresh linear algebra and probability basics.",
            x: 15,
            y: 82,
          },
          {
            id: "ml-a-2",
            title: "Supervised Learning Intro",
            type: "article",
            link: "https://developers.google.com/machine-learning/crash-course",
            description: "Understand labels, features, and model objectives.",
            x: 40,
            y: 61,
          },
          {
            id: "ml-a-3",
            title: "Model Evaluation Essentials",
            type: "documentation",
            link: "https://scikit-learn.org/stable/model_selection.html",
            description: "Use validation metrics to judge model quality.",
            x: 66,
            y: 41,
          },
          {
            id: "ml-a-4",
            title: "First Classification Project",
            type: "practice",
            link: "https://www.kaggle.com/learn/intro-to-machine-learning",
            description: "Train and test your first practical classifier.",
            x: 79,
            y: 28,
          },
        ],
      },
      {
        id: "ml-b",
        name: "Route B: Data Road",
        averageRating: 4.6,
        ratingCount: 76,
        pathColor: "#FFD84D",
        pathD: "M 8 88 C 18 84, 28 74, 40 67 C 50 61, 58 55, 67 48 C 75 40, 82 29, 86 17",
        popularityHint: "Excellent for explorers improving data intuition.",
        steps: [
          {
            id: "ml-b-1",
            title: "Data Cleaning Basics",
            type: "article",
            link: "https://pandas.pydata.org/docs/",
            description: "Handle missing data and noisy records effectively.",
            x: 14,
            y: 85,
          },
          {
            id: "ml-b-2",
            title: "Feature Engineering Lab",
            type: "practice",
            link: "https://www.kaggle.com/learn/feature-engineering",
            description: "Build useful features from raw datasets.",
            x: 40,
            y: 67,
          },
          {
            id: "ml-b-3",
            title: "Data Visualization Guide",
            type: "documentation",
            link: "https://matplotlib.org/stable/tutorials/index",
            description: "Discover trends with clear and readable charts.",
            x: 64,
            y: 49,
          },
          {
            id: "ml-b-4",
            title: "EDA Mini Challenge",
            type: "practice",
            link: "https://www.kaggle.com/learn/pandas",
            description: "Perform exploratory analysis on a new dataset.",
            x: 77,
            y: 33,
          },
        ],
      },
      {
        id: "ml-c",
        name: "Route C: Deployment Road",
        averageRating: 4.4,
        ratingCount: 54,
        pathColor: "#6FB92C",
        pathD: "M 10 74 C 20 66, 30 58, 40 50 C 52 42, 64 34, 74 30 C 80 27, 84 23, 86 17",
        popularityHint: "Great for explorers who want real-world ML delivery.",
        steps: [
          {
            id: "ml-c-1",
            title: "API Serving Concepts",
            type: "video",
            link: "https://fastapi.tiangolo.com/tutorial/",
            description: "Serve model predictions through simple APIs.",
            x: 13,
            y: 74,
          },
          {
            id: "ml-c-2",
            title: "Model Monitoring Notes",
            type: "article",
            link: "https://ml-ops.org/content/mlops-principles",
            description: "Track drift and performance after deployment.",
            x: 38,
            y: 51,
          },
          {
            id: "ml-c-3",
            title: "Container Basics",
            type: "documentation",
            link: "https://docs.docker.com/get-started/",
            description: "Package your ML app for consistent runtime.",
            x: 63,
            y: 34,
          },
          {
            id: "ml-c-4",
            title: "Deploy Demo Service",
            type: "practice",
            link: "https://render.com/docs/deploy-fastapi",
            description: "Push a model-backed service to a cloud host.",
            x: 78,
            y: 23,
          },
        ],
      },
    ],
  },
};

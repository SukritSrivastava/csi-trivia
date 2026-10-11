/**
 * Prompt bank. Add as many as you like: the game picks without repeats
 * until a list runs out, then reshuffles.
 */

/** Head-to-head prompts: two players answer each one. */
export const DUEL_PROMPTS: string[] = [
  "The worst thing to hear from an auto driver",
  "A terrible name for a Mumbai local train station",
  "What the canteen samosa is secretly made of",
  "The real reason the professor is always late",
  "A flavour of Maggi that got rejected",
  "The worst thing to say during a viva",
  "A bad slogan for a dating app",
  "The first rule of hostel life",
  "A useless superpower you'd still brag about",
  "The worst wedding gift",
  "What mom actually means by \"we'll see\"",
  "A new excuse for not submitting the assignment",
  "The worst possible name for a startup",
  "What the WiFi password should be",
  "A rejected name for a monsoon",
  "Something you should never say to a traffic cop",
  "The worst thing to find in your tiffin",
  "A terrible tagline for a coaching class",
  "The real reason the lift in college never works",
  "What your phone would say if it could talk back",
  "A bad name for a chai stall",
  "The worst thing to accidentally post on the family group",
  "A new rule for Bollywood movies",
  "Something you'd hear in a very low-budget cricket commentary",
  "The worst theme for a college fest",
  "A suspicious item on a street food menu",
  "What your neighbour's dog is thinking",
  "The worst thing to shout at a garba night",
  "A rejected subject for first-year engineering",
  "A terrible name for a gym",
  "The worst thing to say on a first date",
  "What really happens at a parent-teacher meeting",
  "A sign you are in the wrong WhatsApp group",
  "The worst thing to bring to a picnic",
  "An unexpected side effect of too much chai",
  "The worst item to win on a game show",
  "A bad name for a pet goldfish",
  "What aliens would complain about after visiting Earth",
  "The worst thing to hear in a job interview",
  "A new ride at Essel World nobody asked for",
  "The worst way to start a group project",
  "Something that should never be sold as a scented candle",
  "A terrible name for a perfume",
  "The worst advice a relative could give at a wedding",
  "What the attendance register would say if it could talk",
  "A bad reason to drop out of a cricket match",
  "The worst thing to forget on a long train journey",
  "A ringtone that would get you thrown out of class",
  "The least scary horror movie title",
  "The worst thing to put on a resume",
  "A new emoji the world desperately needs",
  "What pigeons are planning at the railway station",
  "The worst thing to say when you meet a celebrity",
  "A terrible name for a band",
  "An unusual use for a pressure cooker",
  "The real reason exams are in summer",
  "The worst flavour of ice cream",
  "A bad name for a holiday destination",
  "The worst thing a GPS could say",
  "A new reality show that would definitely flop",
];

/** Final-round prompts: everyone answers the same one. */
export const FINAL_PROMPTS: string[] = [
  "The headline of tomorrow's newspaper",
  "The title of this group's autobiography",
  "Describe this room in three words",
  "The name of the movie about tonight",
  "What the next big viral trend will be",
  "A warning label for this group of friends",
  "The worst possible fortune cookie message",
  "What will be written on your college's next notice board",
  "The slogan for this party",
  "What the TV thinks of everyone watching it",
];

/** Simple shuffle-bag: gives prompts without repeating until the bag empties. */
export class PromptBag {
  private bag: string[] = [];

  constructor(
    private readonly source: string[],
    private readonly random: () => number = Math.random,
  ) {}

  draw(): string {
    if (this.bag.length === 0) {
      this.bag = shuffle([...this.source], this.random);
    }
    return this.bag.pop()!;
  }
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

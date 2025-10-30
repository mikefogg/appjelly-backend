// Consolidated map of users (merged from original and previous suggestions)
const listUserMap = {
  ai: [
    "@ylecun",
    "@karpathy",
    "@AndrewYNg",
    "@demishassabis",
    "@sama",
    "@alliekmiller",
    "@drfeifei",
  ],
  crypto: [
    "@VitalikButerin",
    "@brian_armstrong",
    "@cz_binance",
    "@aantonop",
    "@naval",
    "@APompliano",
    "@RaoulGMI",
  ],
  startups: [
    "@paulg",
    "@bhorowitz",
    "@eladgil",
    "@naval",
    "@pmarca",
    "@hnshah",
    "@jasonlk",
    "@kevinrose",
    "@reidhoffman",
  ],
  dev: [
    "@wesbos",
    "@addyosmani",
    "@dan_abramov",
    "@kentcdodds",
    "@codinghorror",
    "@chriscoyier",
    "@jeresig",
    "@sarasoueidan",
  ],
  design: [
    "@lukew",
    "@jessicahische",
    "@smashingmag",
    "@chriscoyier",
    "@jessicasvendsen",
    "@aarron",
    "@jnd1er",
    "@joulee",
  ],
  marketing: [
    "@randfish",
    "@neilpatel",
    "@annhandley",
    "@sethgodin",
    "@aprildunford",
    "@brianbalfour",
    "@garyvee",
    "@larrykim",
  ],
  productivity: [
    "@tferriss",
    "@david_perell",
    "@jaltucher",
    "@nateliason",
    "@thomasfrank",
    "@gtdguy",
    "@tiagoforte",
    "@lvanderkam",
    "@nireyal",
  ],
  finance: [
    "@APompliano",
    "@barrysilbert",
    "@cathiedwood",
    "@LynAldenContact",
    "@RaoulGMI",
    "@ritholtz",
    "@chamath",
    "@morganhousel",
  ],
  tech: [
    "@TechCrunch",
    "@benedictevans",
    "@verge",
    "@Techmeme",
    "@shiraovide",
    "@engadget",
    "@WIRED",
    "@ZDNet",
  ],
  saas: [
    "@dharmesh",
    "@jasonlk",
    "@aarontweet",
    "@tylercowen",
    "@davidcummings",
    "@danmartell",
    "@nathanlatka",
    "@pcampbell",
  ],
  product: [
    "@shreyas",
    "@jwiechers",
    "@gibsonbiddle",
    "@rchoi",
    "@kennethn",
    "@johncutle",
    "@lennysan",
    "@melissperri",
    "@sachinrekhi",
  ],
  sales: [
    "@jill_rowley",
    "@anthonypierri",
    "@msuster",
    "@Steli",
    "@kevinmdorsey",
    "@iannarino",
    "@salesleadership",
    "@jillkonrath",
    "@thesaleshunter",
  ],
  leadership: [
    "@simonsinek",
    "@AdamMGrant",
    "@brenebrown",
    "@kimballscott",
    "@LaszloBock2718",
    "@DanielCoyle",
  ],
  creator: [
    "@jackconte",
    "@mkbhd",
    "@Casey",
    "@patflynn",
    "@anthonypadua",
    "@aliabdaal",
    "@garyvee",
    "@MrBeast",
    "@shl",
  ],
  gaming: [
    "@geoffkeighley",
    "@jasonschreier",
    "@IGN",
    "@charlieINTEL",
    "@esportscenter",
    "@DrDisrespect",
    "@JakeSucky",
    "@Ninja",
    "@shroud",
  ],
  health: [
    "@hubermanlab",
    "@drjoshaxe",
    "@Mark_Sisson",
    "@DrGundry",
    "@drmikehart",
    "@drmikeisraetel",
    "@BioLayne",
    "@menselmans",
    "@foundmyfitness",
    "@SBakerMD",
  ],
  climate: [
    "@GernotWagner",
    "@KHayhoe",
    "@ClimateCentral",
    "@MichaelEMann",
    "@cleantechnica",
    "@billmckibben",
    "@NaomiAKlein",
    "@GretaThunberg",
  ],
  science: [
    "@neiltyson",
    "@brian_cox",
    "@SciAm",
    "@carlzimmer",
    "@edyong209",
    "@bgreene",
    "@JenLucPiquant",
    "@seanmcarroll",
  ],
  education: [
    "@salkhanacademy",
    "@coursera",
    "@edXorg",
    "@SirKenRobinson",
    "@ajjuliani",
    "@alfredessa",
    "@audreywatters",
    "@TEDTalks",
    "@coolcatteacher",
  ],
  remote: [
    "@darrenmurph",
    "@chrisherd",
    "@remote",
    "@nickbloom",
    "@laurelwreath",
    "@basecamp",
    "@jasonfried",
    "@kitperez",
    "@tasodval",
  ],
};

// Specify the slug of the current list you're on (e.g., "ai", "crypto", etc.)
const currentListSlug = "ai"; // CHANGE THIS FOR EACH LIST (e.g., "crypto", "finance")

// Get usernames for the current list
const usernames = listUserMap[currentListSlug] || [];
if (usernames.length === 0) {
  console.error(
    `No users found for slug "${currentListSlug}". Check the slug.`
  );
  throw new Error("Invalid list slug");
}

// Function to add a single user to the current list
async function addUserToList(username) {
  // Click the search/add button (adapt selector if UI changes)
  const addButton = document.querySelector(
    'button[aria-label*="Add to list"], [data-testid="list-AddToListButton"]'
  );
  if (!addButton) {
    console.error("Add button not found. Scroll/refresh the list page.");
    return false;
  }
  addButton.click();

  // Wait for search modal to open
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Find/search input in the modal
  const searchInput = document.querySelector(
    'input[placeholder*="Search"], [data-testid="user-search"]'
  );
  if (!searchInput) {
    console.error("Search input not found in modal.");
    return false;
  }
  searchInput.focus();
  searchInput.value = username;
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));

  // Wait for results
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Click the first matching user result
  const userResult = Array.from(
    document.querySelectorAll(
      '[data-testid="user-result"], div[role="button"] a[href^="/"]'
    )
  ).find(
    (el) =>
      el.textContent.includes(username.replace("@", "")) ||
      el.querySelector("a")?.href.includes(username.replace("@", ""))
  );
  if (!userResult) {
    console.error(`User ${username} not found in search results.`);
    return false;
  }
  userResult.click();

  // Confirm add (if prompted)
  await new Promise((resolve) => setTimeout(resolve, 500));
  const confirmButton = document.querySelector(
    'button[aria-label*="Add"], [data-testid="ocf_SettingsListAddConfirmationNextButton"]'
  );
  if (confirmButton) {
    confirmButton.click();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`Added ${username} to the list.`);
  return true;
}

// Main function: Add all users sequentially with delays to avoid rate limits
async function addAllUsers() {
  console.log(
    `Starting to add ${usernames.length} users to the "${currentListSlug}" list...`
  );
  console.log(`Users: ${usernames.join(", ")}`);
  for (let i = 0; i < usernames.length; i++) {
    const success = await addUserToList(usernames[i]);
    if (!success) {
      console.warn(`Failed to add ${usernames[i]}. Skipping.`);
    }
    // Delay between adds (adjust as needed)
    if (i < usernames.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000)); // 3s delay
    }
  }
  console.log("Done adding users!");
}

// Run it
addAllUsers().catch((error) => console.error("Error:", error));

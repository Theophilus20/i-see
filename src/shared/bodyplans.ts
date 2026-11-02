/**
 * Body plans: the correct names for what a kind of living thing (or common object) has on the
 * outside and inside, as biology and engineering name them.
 *
 * Used to:
 *  - name the parts outlined on a photo with the right terms (a "hock", not a "lower leg bend"),
 *  - choose what the inside drawing shows and labels (the real bones and organs, not "torso"),
 *  - give the writing step the key facts that are easy to get wrong (a cow's four stomach
 *    chambers, a bird's gizzard, a fish's swim bladder).
 *
 * The lists are standard, well-established anatomy and engineering; species-level detail still
 * comes from the sources found for each object.
 */

export interface BodyPlan {
  id: string;
  /** What kind of thing this is, in plain words. */
  group: string;
  living: boolean;
  /** Parts that can be seen from outside, by their correct names. */
  external: string[];
  /** Bones (or the hard framework: exoskeleton, cartilage, shell, frame). */
  skeleton: string[];
  /** Organs and soft inner structures (or, for objects, the inner components). */
  internal: string[];
  /** What the inside drawing labels: the most important inner parts, in a sensible order. */
  label: string[];
  /** Facts that are easy to get wrong, for the writing and drawing steps. */
  facts: string;
  /** Words that identify this group in a name (whole words, lower case). */
  words: string[];
}

const MAMMAL_SKELETON = ['Skull', 'Mandible', 'Cervical vertebrae', 'Thoracic vertebrae', 'Lumbar vertebrae', 'Sacrum', 'Tail vertebrae', 'Ribs', 'Sternum', 'Scapula', 'Humerus', 'Radius and ulna', 'Carpal bones', 'Pelvis', 'Femur', 'Patella', 'Tibia and fibula', 'Tarsal bones', 'Phalanges'];

export const BODY_PLANS: BodyPlan[] = [
  // ---------------------------------------------------------------- mammals
  {
    id: 'ruminant',
    group: 'ruminant mammal',
    living: true,
    words: ['cow', 'cows', 'cattle', 'bull', 'ox', 'oxen', 'calf', 'heifer', 'steer', 'zebu', 'bison', 'buffalo', 'yak', 'goat', 'sheep', 'lamb', 'ram', 'ewe', 'deer', 'stag', 'elk', 'moose', 'reindeer', 'caribou', 'antelope', 'gazelle', 'impala', 'wildebeest', 'gnu', 'giraffe', 'okapi', 'kudu'],
    external: ['Head', 'Ear', 'Eye', 'Horn', 'Muzzle', 'Nostril', 'Mouth', 'Dewlap', 'Neck', 'Front leg', 'Hind leg', 'Knee', 'Hock', 'Fetlock', 'Cloven hoof', 'Dewclaw', 'Tail', 'Tail switch', 'Udder', 'Teat'],
    skeleton: ['Skull', 'Mandible', 'Cervical vertebrae', 'Thoracic vertebrae', 'Lumbar vertebrae', 'Sacrum', 'Tail vertebrae', 'Ribs', 'Sternum', 'Scapula', 'Humerus', 'Radius and ulna', 'Carpal bones', 'Cannon bone', 'Pelvis', 'Femur', 'Patella', 'Tibia', 'Tarsal bones', 'Phalanges'],
    internal: ['Brain', 'Spinal cord', 'Trachea', 'Oesophagus', 'Lungs', 'Heart', 'Diaphragm', 'Liver', 'Rumen', 'Reticulum', 'Omasum', 'Abomasum', 'Small intestine', 'Caecum', 'Large intestine', 'Kidneys', 'Bladder', 'Spleen', 'Mammary gland'],
    label: ['Skull', 'Vertebral column', 'Ribs', 'Scapula', 'Pelvis', 'Femur', 'Brain', 'Trachea', 'Heart', 'Lungs', 'Liver', 'Rumen', 'Small intestine', 'Kidneys'],
    facts: 'Ruminants have one stomach with four chambers: rumen, reticulum, omasum and abomasum (the true stomach). They have no upper front teeth, only a hard dental pad. Each foot has two weight-bearing toes (a cloven hoof) and two dewclaws; the cannon bone is the fused third and fourth metacarpal or metatarsal. They have no collarbone. The rumen fills most of the left side of the belly: seen from the left it is the largest organ; seen from the right, the liver, omasum, abomasum and intestines lie in front of it and it is mostly hidden.',
  },
  {
    id: 'equine',
    group: 'horse family mammal',
    living: true,
    words: ['horse', 'horses', 'pony', 'foal', 'mare', 'stallion', 'donkey', 'mule', 'zebra'],
    external: ['Head', 'Poll', 'Ear', 'Eye', 'Muzzle', 'Nostril', 'Mane', 'Neck', 'Front leg', 'Hind leg', 'Knee', 'Hock', 'Fetlock', 'Pastern', 'Hoof', 'Chestnut', 'Tail'],
    skeleton: ['Skull', 'Mandible', 'Cervical vertebrae', 'Thoracic vertebrae', 'Lumbar vertebrae', 'Sacrum', 'Tail vertebrae', 'Ribs', 'Sternum', 'Scapula', 'Humerus', 'Radius', 'Carpal bones', 'Cannon bone', 'Splint bones', 'Pastern bones', 'Coffin bone', 'Pelvis', 'Femur', 'Patella', 'Tibia', 'Tarsal bones'],
    internal: ['Brain', 'Trachea', 'Oesophagus', 'Lungs', 'Heart', 'Diaphragm', 'Liver', 'Stomach', 'Small intestine', 'Caecum', 'Large colon', 'Small colon', 'Kidneys', 'Bladder', 'Spleen'],
    label: ['Skull', 'Vertebral column', 'Ribs', 'Scapula', 'Pelvis', 'Femur', 'Cannon bone', 'Brain', 'Trachea', 'Heart', 'Lungs', 'Liver', 'Stomach', 'Caecum', 'Large colon'],
    facts: 'Horses have a single small stomach and a very large caecum and colon where fibre is fermented; they have no gallbladder and cannot vomit. Each leg ends in one toe, the hoof, around the coffin bone. They have no collarbone.',
  },
  {
    id: 'pig',
    group: 'pig',
    living: true,
    words: ['pig', 'pigs', 'hog', 'boar', 'sow', 'piglet', 'swine', 'warthog'],
    external: ['Snout', 'Ear', 'Eye', 'Mouth', 'Tusk', 'Neck', 'Front leg', 'Hind leg', 'Cloven hoof', 'Dewclaw', 'Tail', 'Teat'],
    skeleton: MAMMAL_SKELETON,
    internal: ['Brain', 'Trachea', 'Oesophagus', 'Lungs', 'Heart', 'Diaphragm', 'Liver', 'Gallbladder', 'Stomach', 'Small intestine', 'Caecum', 'Spiral colon', 'Kidneys', 'Bladder', 'Spleen'],
    label: ['Skull', 'Vertebral column', 'Ribs', 'Scapula', 'Pelvis', 'Femur', 'Brain', 'Trachea', 'Heart', 'Lungs', 'Liver', 'Stomach', 'Small intestine', 'Kidneys'],
    facts: 'Pigs have a single-chambered stomach and a spiral colon. The snout has a disc of cartilage with the nostrils, used for rooting.',
  },
  {
    id: 'elephant',
    group: 'elephant',
    living: true,
    words: ['elephant', 'elephants', 'mammoth'],
    external: ['Trunk', 'Tusk', 'Ear', 'Eye', 'Head', 'Front leg', 'Hind leg', 'Foot', 'Toenails', 'Tail'],
    skeleton: MAMMAL_SKELETON,
    internal: ['Brain', 'Trachea', 'Lungs', 'Heart', 'Liver', 'Stomach', 'Small intestine', 'Caecum', 'Large intestine', 'Kidneys', 'Bladder'],
    label: ['Skull', 'Tusk', 'Vertebral column', 'Ribs', 'Scapula', 'Pelvis', 'Femur', 'Brain', 'Trachea', 'Heart', 'Lungs', 'Liver', 'Stomach', 'Caecum'],
    facts: 'The trunk is the nose joined with the upper lip, with no bone in it. Tusks are elongated upper incisors. Elephants have no gallbladder, and their lungs are attached to the chest wall.',
  },
  {
    id: 'cetacean',
    group: 'whale or dolphin',
    living: true,
    words: ['whale', 'whales', 'dolphin', 'dolphins', 'porpoise', 'orca'],
    external: ['Rostrum', 'Melon', 'Blowhole', 'Eye', 'Flipper', 'Dorsal fin', 'Fluke'],
    skeleton: ['Skull', 'Mandible', 'Cervical vertebrae', 'Thoracic vertebrae', 'Lumbar vertebrae', 'Tail vertebrae', 'Ribs', 'Sternum', 'Scapula', 'Humerus', 'Radius and ulna', 'Phalanges', 'Vestigial pelvis'],
    internal: ['Brain', 'Blowhole', 'Lungs', 'Heart', 'Liver', 'Forestomach', 'Main stomach', 'Intestines', 'Kidneys'],
    label: ['Skull', 'Vertebral column', 'Ribs', 'Flipper bones', 'Vestigial pelvis', 'Brain', 'Blowhole', 'Lungs', 'Heart', 'Liver', 'Main stomach', 'Intestines', 'Kidneys'],
    facts: 'Whales and dolphins breathe air through the blowhole; the flippers contain the same arm and finger bones as land mammals; only a small, unattached pelvis remains. The fluke and dorsal fin have no bones. Their stomach has several chambers.',
  },
  {
    id: 'bat',
    group: 'bat',
    living: true,
    words: ['bat', 'bats', 'fruit bat', 'flying fox'],
    external: ['Head', 'Ear', 'Eye', 'Nose leaf', 'Wing membrane', 'Thumb claw', 'Hind foot', 'Tail membrane'],
    skeleton: ['Skull', 'Mandible', 'Vertebral column', 'Ribs', 'Sternum', 'Clavicle', 'Scapula', 'Humerus', 'Radius', 'Elongated finger bones', 'Thumb', 'Pelvis', 'Femur', 'Calcar'],
    internal: ['Brain', 'Trachea', 'Lungs', 'Heart', 'Liver', 'Stomach', 'Intestines', 'Kidneys'],
    label: ['Skull', 'Humerus', 'Elongated finger bones', 'Vertebral column', 'Ribs', 'Femur', 'Brain', 'Heart', 'Lungs', 'Liver', 'Stomach', 'Intestines'],
    facts: 'A bat wing is skin stretched between very long finger bones; the thumb stays free with a claw. Bats are the only mammals that truly fly.',
  },
  {
    id: 'rodent',
    group: 'rodent or rabbit',
    living: true,
    words: ['rat', 'rats', 'mouse', 'mice', 'hamster', 'gerbil', 'guinea pig', 'cavy', 'squirrel', 'chipmunk', 'rabbit', 'rabbits', 'bunny', 'hare', 'capybara', 'beaver', 'porcupine', 'chinchilla', 'degu', 'dormouse', 'vole', 'marmot', 'groundhog'],
    external: ['Head', 'Ear', 'Eye', 'Whiskers', 'Nose', 'Incisors', 'Mouth', 'Front paw', 'Hind paw', 'Claws', 'Tail'],
    skeleton: ['Skull', 'Mandible', 'Incisors', 'Cervical vertebrae', 'Thoracic vertebrae', 'Lumbar vertebrae', 'Tail vertebrae', 'Ribs', 'Sternum', 'Clavicle', 'Scapula', 'Humerus', 'Radius and ulna', 'Pelvis', 'Femur', 'Tibia and fibula', 'Phalanges'],
    internal: ['Brain', 'Trachea', 'Lungs', 'Heart', 'Diaphragm', 'Liver', 'Stomach', 'Small intestine', 'Caecum', 'Large intestine', 'Kidneys', 'Bladder', 'Spleen'],
    label: ['Skull', 'Incisors', 'Vertebral column', 'Ribs', 'Scapula', 'Pelvis', 'Femur', 'Brain', 'Heart', 'Lungs', 'Liver', 'Stomach', 'Caecum', 'Small intestine'],
    facts: 'Rodents have one pair of upper and one pair of lower incisors that never stop growing (rabbits and hares have a second, small pair behind the upper ones). They have a large caecum for digesting plants. Rats have no gallbladder and cannot vomit.',
  },
  {
    id: 'carnivoran',
    group: 'carnivoran mammal (cat or dog family and relatives)',
    living: true,
    words: ['cat', 'cats', 'kitten', 'dog', 'dogs', 'puppy', 'lion', 'lioness', 'tiger', 'leopard', 'cheetah', 'jaguar', 'lynx', 'puma', 'cougar', 'fox', 'wolf', 'jackal', 'coyote', 'hyena', 'bear', 'panda', 'raccoon', 'otter', 'weasel', 'ferret', 'badger', 'mongoose', 'meerkat', 'seal', 'sea lion', 'walrus', 'skunk'],
    external: ['Head', 'Ear', 'Eye', 'Whiskers', 'Nose', 'Muzzle', 'Mouth', 'Neck', 'Front leg', 'Hind leg', 'Paw', 'Claws', 'Paw pads', 'Tail'],
    skeleton: MAMMAL_SKELETON,
    internal: ['Brain', 'Spinal cord', 'Trachea', 'Oesophagus', 'Lungs', 'Heart', 'Diaphragm', 'Liver', 'Gallbladder', 'Stomach', 'Small intestine', 'Large intestine', 'Kidneys', 'Bladder', 'Spleen', 'Pancreas'],
    label: ['Skull', 'Vertebral column', 'Ribs', 'Scapula', 'Pelvis', 'Femur', 'Brain', 'Trachea', 'Heart', 'Lungs', 'Liver', 'Stomach', 'Small intestine', 'Kidneys'],
    facts: 'Carnivorans have a simple, single-chambered stomach, long canine teeth and shearing carnassial teeth. Cats walk on their toes with retractable claws; their collarbone is small and floating.',
  },
  {
    id: 'primate',
    group: 'primate',
    living: true,
    words: ['monkey', 'monkeys', 'ape', 'apes', 'chimpanzee', 'gorilla', 'orangutan', 'baboon', 'macaque', 'gibbon', 'lemur', 'marmoset', 'tamarin', 'human', 'person', 'man', 'woman', 'child', 'baby'],
    external: ['Head', 'Face', 'Ear', 'Eye', 'Nose', 'Mouth', 'Neck', 'Arm', 'Hand', 'Fingers', 'Thumb', 'Leg', 'Foot', 'Toes', 'Tail'],
    skeleton: ['Skull', 'Mandible', 'Cervical vertebrae', 'Thoracic vertebrae', 'Lumbar vertebrae', 'Sacrum', 'Ribs', 'Sternum', 'Clavicle', 'Scapula', 'Humerus', 'Radius', 'Ulna', 'Carpal bones', 'Metacarpals', 'Phalanges', 'Pelvis', 'Femur', 'Patella', 'Tibia', 'Fibula', 'Tarsal bones', 'Metatarsals'],
    internal: ['Brain', 'Trachea', 'Oesophagus', 'Lungs', 'Heart', 'Diaphragm', 'Liver', 'Gallbladder', 'Stomach', 'Pancreas', 'Spleen', 'Small intestine', 'Large intestine', 'Kidneys', 'Bladder'],
    label: ['Skull', 'Clavicle', 'Ribs', 'Vertebral column', 'Humerus', 'Pelvis', 'Femur', 'Brain', 'Heart', 'Lungs', 'Liver', 'Stomach', 'Small intestine', 'Kidneys'],
    facts: 'Primates have forward-facing eyes, a collarbone, and hands with five fingers and nails; most have an opposable thumb.',
  },
  // ------------------------------------------------------------------ birds
  {
    id: 'bird',
    group: 'bird',
    living: true,
    words: ['bird', 'birds', 'chicken', 'hen', 'rooster', 'cockerel', 'chick', 'duck', 'duckling', 'goose', 'turkey', 'pigeon', 'dove', 'parrot', 'parakeet', 'budgie', 'budgerigar', 'cockatoo', 'macaw', 'eagle', 'hawk', 'falcon', 'kite', 'vulture', 'owl', 'sparrow', 'finch', 'canary', 'robin', 'crow', 'raven', 'magpie', 'starling', 'swallow', 'ostrich', 'emu', 'penguin', 'peacock', 'peafowl', 'flamingo', 'swan', 'heron', 'stork', 'crane', 'kingfisher', 'hummingbird', 'woodpecker', 'seagull', 'gull', 'pelican', 'quail', 'guinea fowl', 'weaver'],
    external: ['Beak', 'Nostril', 'Eye', 'Comb', 'Wattle', 'Crest', 'Head', 'Neck', 'Wing', 'Primary feathers', 'Secondary feathers', 'Tail feathers', 'Leg', 'Foot', 'Toes', 'Talons', 'Spur'],
    skeleton: ['Skull', 'Beak', 'Neck vertebrae', 'Keel', 'Furcula', 'Coracoid', 'Scapula', 'Humerus', 'Radius and ulna', 'Carpometacarpus', 'Ribs', 'Synsacrum', 'Pygostyle', 'Femur', 'Tibiotarsus', 'Tarsometatarsus', 'Toe bones'],
    internal: ['Brain', 'Trachea', 'Syrinx', 'Oesophagus', 'Crop', 'Proventriculus', 'Gizzard', 'Liver', 'Heart', 'Lungs', 'Air sacs', 'Small intestine', 'Caeca', 'Kidneys', 'Cloaca'],
    label: ['Skull', 'Keel', 'Furcula', 'Humerus', 'Synsacrum', 'Femur', 'Tibiotarsus', 'Brain', 'Trachea', 'Crop', 'Heart', 'Lungs', 'Gizzard', 'Liver'],
    facts: 'Birds have no teeth: food is stored in the crop and ground in the muscular gizzard. Their lungs are small and rigid and work with air sacs, so air flows through them in one direction. The keel of the breastbone anchors the flight muscles; the wishbone (furcula) is the fused collarbones. One opening, the cloaca, serves for waste and eggs. Many bones are hollow.',
  },
  // ------------------------------------------------------------------- fish
  {
    id: 'shark',
    group: 'shark or ray (cartilaginous fish)',
    living: true,
    words: ['shark', 'sharks', 'ray', 'stingray', 'manta', 'skate', 'dogfish'],
    external: ['Snout', 'Mouth', 'Eye', 'Gill slits', 'First dorsal fin', 'Second dorsal fin', 'Pectoral fin', 'Pelvic fin', 'Anal fin', 'Caudal fin', 'Claspers'],
    skeleton: ['Cartilage skull', 'Jaws', 'Vertebral column', 'Fin rays'],
    internal: ['Brain', 'Gills', 'Heart', 'Liver', 'Stomach', 'Spiral valve intestine', 'Kidneys', 'Rectal gland'],
    label: ['Cartilage skull', 'Jaws', 'Vertebral column', 'Brain', 'Gills', 'Heart', 'Liver', 'Stomach', 'Spiral valve intestine', 'Kidneys'],
    facts: 'Sharks and rays have a skeleton of cartilage, not bone, and no swim bladder: a large oily liver keeps them afloat. They breathe through five to seven gill slits and have rows of replaceable teeth.',
  },
  {
    id: 'fish',
    group: 'bony fish',
    living: true,
    words: ['fish', 'fishes', 'salmon', 'trout', 'tilapia', 'catfish', 'carp', 'koi', 'goldfish', 'tuna', 'cod', 'haddock', 'mackerel', 'sardine', 'herring', 'anchovy', 'guppy', 'betta', 'clownfish', 'angelfish', 'perch', 'bass', 'pike', 'snapper', 'grouper', 'tetra', 'barb', 'eel', 'seahorse', 'pufferfish', 'flounder', 'sole', 'swordfish'],
    external: ['Head', 'Mouth', 'Eye', 'Nostril', 'Barbels', 'Operculum', 'Pectoral fin', 'Pelvic fin', 'Dorsal fin', 'Adipose fin', 'Anal fin', 'Caudal fin', 'Lateral line', 'Scales'],
    skeleton: ['Skull', 'Jaw', 'Gill arches', 'Vertebral column', 'Ribs', 'Pectoral girdle', 'Fin rays'],
    internal: ['Brain', 'Gills', 'Heart', 'Liver', 'Stomach', 'Intestine', 'Swim bladder', 'Kidney', 'Gonads', 'Spleen'],
    label: ['Skull', 'Vertebral column', 'Ribs', 'Fin rays', 'Brain', 'Gills', 'Heart', 'Liver', 'Stomach', 'Intestine', 'Swim bladder', 'Kidney'],
    facts: 'Bony fish breathe with gills under a bony gill cover (operculum). The swim bladder is a gas-filled sac for buoyancy. The heart has two chambers. The lateral line senses movement in the water.',
  },
  // ----------------------------------------------------- reptiles, amphibians
  {
    id: 'turtle',
    group: 'turtle or tortoise',
    living: true,
    words: ['turtle', 'turtles', 'tortoise', 'tortoises', 'terrapin'],
    external: ['Head', 'Beak', 'Eye', 'Neck', 'Carapace', 'Plastron', 'Scutes', 'Front leg', 'Hind leg', 'Claws', 'Flippers', 'Tail'],
    skeleton: ['Skull', 'Carapace bone', 'Plastron bone', 'Neck vertebrae', 'Ribs fused to shell', 'Pectoral girdle', 'Pelvic girdle', 'Limb bones'],
    internal: ['Brain', 'Trachea', 'Lungs', 'Heart', 'Liver', 'Stomach', 'Intestines', 'Kidneys', 'Bladder', 'Cloaca'],
    label: ['Skull', 'Carapace bone', 'Ribs fused to shell', 'Pectoral girdle', 'Pelvic girdle', 'Brain', 'Lungs', 'Heart', 'Liver', 'Stomach', 'Intestines'],
    facts: 'The shell is part of the skeleton: the ribs and spine are fused to the carapace, so a turtle cannot leave its shell. The shoulder and hip girdles sit inside the rib cage. Turtles have a beak and no teeth.',
  },
  {
    id: 'snake',
    group: 'snake',
    living: true,
    words: ['snake', 'snakes', 'python', 'boa', 'cobra', 'viper', 'mamba', 'adder', 'anaconda', 'rattlesnake'],
    external: ['Head', 'Eye', 'Nostril', 'Mouth', 'Forked tongue', 'Scales', 'Ventral scales', 'Tail'],
    skeleton: ['Skull', 'Jaws', 'Vertebrae', 'Ribs'],
    internal: ['Brain', 'Trachea', 'Right lung', 'Heart', 'Liver', 'Stomach', 'Intestine', 'Kidneys', 'Cloaca'],
    label: ['Skull', 'Jaws', 'Vertebrae', 'Ribs', 'Brain', 'Trachea', 'Heart', 'Right lung', 'Liver', 'Stomach', 'Intestine', 'Kidneys'],
    facts: 'Snakes have hundreds of vertebrae, each with a pair of ribs, and no legs, eyelids or external ears. Usually only the right lung is fully developed. Organs are long and arranged one after another.',
  },
  {
    id: 'reptile',
    group: 'lizard or crocodilian',
    living: true,
    words: ['lizard', 'lizards', 'gecko', 'iguana', 'chameleon', 'monitor', 'skink', 'agama', 'komodo', 'crocodile', 'alligator', 'caiman'],
    external: ['Head', 'Eye', 'Nostril', 'Ear opening', 'Mouth', 'Tongue', 'Scales', 'Neck', 'Front leg', 'Hind leg', 'Claws', 'Tail', 'Casque', 'Dewlap'],
    skeleton: ['Skull', 'Jaws', 'Vertebrae', 'Ribs', 'Pectoral girdle', 'Pelvic girdle', 'Humerus', 'Femur', 'Tail vertebrae'],
    internal: ['Brain', 'Trachea', 'Lungs', 'Heart', 'Liver', 'Stomach', 'Intestines', 'Kidneys', 'Cloaca'],
    label: ['Skull', 'Vertebrae', 'Ribs', 'Pectoral girdle', 'Pelvic girdle', 'Femur', 'Tail vertebrae', 'Brain', 'Lungs', 'Heart', 'Liver', 'Stomach', 'Intestines'],
    facts: 'Lizards have a three-chambered heart; crocodilians have a four-chambered heart. Many lizards can shed the tail, which breaks at weak points in the tail vertebrae. Reptiles have one opening, the cloaca.',
  },
  {
    id: 'amphibian',
    group: 'amphibian',
    living: true,
    words: ['frog', 'frogs', 'toad', 'toads', 'salamander', 'newt', 'axolotl', 'tadpole', 'caecilian'],
    external: ['Head', 'Eye', 'Tympanum', 'Nostril', 'Mouth', 'Front leg', 'Hind leg', 'Webbed foot', 'Toes', 'Parotoid gland', 'External gills', 'Tail'],
    skeleton: ['Skull', 'Vertebrae', 'Urostyle', 'Pectoral girdle', 'Pelvic girdle', 'Radio-ulna', 'Femur', 'Tibiofibula', 'Phalanges'],
    internal: ['Brain', 'Lungs', 'Heart', 'Liver', 'Stomach', 'Intestines', 'Kidneys', 'Fat bodies', 'Bladder', 'Cloaca'],
    label: ['Skull', 'Vertebrae', 'Urostyle', 'Pelvic girdle', 'Femur', 'Tibiofibula', 'Brain', 'Lungs', 'Heart', 'Liver', 'Stomach', 'Intestines'],
    facts: 'Amphibians also breathe through their thin, moist skin. A frog has no ribs or only very short ones, and its tail bones are fused into the urostyle. The heart has three chambers. The round tympanum behind the eye is the eardrum.',
  },
  // ---------------------------------------------------------- invertebrates
  {
    id: 'insect',
    group: 'insect',
    living: true,
    words: ['insect', 'insects', 'ant', 'ants', 'bee', 'bees', 'honeybee', 'bumblebee', 'wasp', 'hornet', 'butterfly', 'moth', 'beetle', 'ladybird', 'ladybug', 'weevil', 'fly', 'housefly', 'mosquito', 'grasshopper', 'locust', 'cricket', 'cockroach', 'roach', 'dragonfly', 'damselfly', 'termite', 'mantis', 'cicada', 'aphid', 'caterpillar', 'firefly', 'stick insect'],
    external: ['Head', 'Antennae', 'Compound eyes', 'Mouthparts', 'Mandibles', 'Proboscis', 'Thorax', 'Abdomen', 'Forewings', 'Hindwings', 'Elytra', 'Legs', 'Tarsi', 'Spiracles', 'Stinger'],
    skeleton: ['Exoskeleton'],
    internal: ['Brain', 'Ventral nerve cord', 'Dorsal vessel', 'Oesophagus', 'Crop', 'Midgut', 'Hindgut', 'Malpighian tubules', 'Tracheae', 'Flight muscles', 'Fat body', 'Ovaries'],
    label: ['Exoskeleton', 'Brain', 'Ventral nerve cord', 'Dorsal vessel', 'Crop', 'Midgut', 'Hindgut', 'Malpighian tubules', 'Tracheae', 'Flight muscles'],
    facts: 'Insects have six legs and three body parts (head, thorax, abdomen), an exoskeleton instead of bones, and open circulation with a tube-shaped heart (the dorsal vessel) along the back. Air enters through spiracles and travels in tubes called tracheae; insects have no lungs.',
  },
  {
    id: 'arachnid',
    group: 'arachnid',
    living: true,
    words: ['spider', 'spiders', 'tarantula', 'scorpion', 'scorpions', 'tick', 'ticks', 'mite', 'mites', 'harvestman'],
    external: ['Cephalothorax', 'Abdomen', 'Eyes', 'Chelicerae', 'Fangs', 'Pedipalps', 'Legs', 'Spinnerets', 'Pincers', 'Metasoma', 'Telson'],
    skeleton: ['Exoskeleton'],
    internal: ['Brain', 'Venom glands', 'Sucking stomach', 'Heart', 'Book lungs', 'Midgut', 'Malpighian tubules', 'Silk glands', 'Ovaries'],
    label: ['Exoskeleton', 'Brain', 'Venom glands', 'Sucking stomach', 'Heart', 'Book lungs', 'Midgut', 'Silk glands'],
    facts: 'Arachnids have eight legs, two body parts and no antennae. Spiders breathe with book lungs, inject venom through fangs on the chelicerae and spin silk from spinnerets. A scorpion’s pincers are its pedipalps and its stinger is the telson.',
  },
  {
    id: 'crustacean',
    group: 'crustacean',
    living: true,
    words: ['crab', 'crabs', 'lobster', 'shrimp', 'prawn', 'crayfish', 'crawfish', 'krill', 'woodlouse', 'barnacle'],
    external: ['Carapace', 'Antennae', 'Antennules', 'Eyestalks', 'Claws', 'Walking legs', 'Swimmerets', 'Abdomen', 'Tail fan'],
    skeleton: ['Exoskeleton'],
    internal: ['Brain', 'Gills', 'Heart', 'Stomach', 'Gastric mill', 'Hepatopancreas', 'Intestine', 'Green gland', 'Ventral nerve cord'],
    label: ['Exoskeleton', 'Brain', 'Gills', 'Heart', 'Stomach', 'Hepatopancreas', 'Intestine', 'Green gland'],
    facts: 'Crustaceans have a hard exoskeleton that they moult to grow, two pairs of antennae and gills under the carapace. Their stomach has a gastric mill with teeth that grinds food.',
  },
  {
    id: 'mollusc',
    group: 'mollusc',
    living: true,
    words: ['snail', 'snails', 'slug', 'slugs', 'octopus', 'squid', 'cuttlefish', 'nautilus', 'clam', 'oyster', 'mussel', 'scallop', 'cockle', 'whelk', 'limpet', 'conch'],
    external: ['Shell', 'Foot', 'Head', 'Tentacles', 'Eyes', 'Mantle', 'Breathing pore', 'Arms', 'Suckers', 'Siphon', 'Beak', 'Hinge'],
    skeleton: ['Shell', 'Pen', 'Cuttlebone'],
    internal: ['Brain', 'Radula', 'Gills', 'Lung', 'Heart', 'Stomach', 'Digestive gland', 'Intestine', 'Kidney', 'Ink sac'],
    label: ['Shell', 'Brain', 'Radula', 'Gills', 'Heart', 'Stomach', 'Digestive gland', 'Kidney', 'Ink sac'],
    facts: 'Molluscs have a soft body with a muscular foot and a mantle that makes the shell; most feed with a radula, a tongue covered in tiny teeth. Land snails breathe with a lung; octopuses have three hearts and blue blood.',
  },
  {
    id: 'worm',
    group: 'segmented worm',
    living: true,
    words: ['earthworm', 'worm', 'worms', 'leech', 'leeches'],
    external: ['Prostomium', 'Mouth', 'Segments', 'Clitellum', 'Setae', 'Anus'],
    skeleton: ['Hydrostatic skeleton'],
    internal: ['Brain', 'Pharynx', 'Oesophagus', 'Crop', 'Gizzard', 'Intestine', 'Aortic arches', 'Dorsal blood vessel', 'Ventral nerve cord', 'Nephridia'],
    label: ['Brain', 'Pharynx', 'Crop', 'Gizzard', 'Intestine', 'Aortic arches', 'Dorsal blood vessel', 'Ventral nerve cord'],
    facts: 'An earthworm has no bones: fluid-filled segments act as a hydrostatic skeleton. It has five pairs of aortic arches (“hearts”), breathes through its skin and grinds soil in a gizzard.',
  },
  // ----------------------------------------------------------- plants, fungi
  {
    id: 'fungus',
    group: 'fungus',
    living: true,
    words: ['mushroom', 'mushrooms', 'toadstool', 'fungus', 'fungi', 'bolete', 'chanterelle', 'puffball', 'bracket'],
    external: ['Cap', 'Gills', 'Pores', 'Stipe', 'Ring', 'Volva', 'Scales'],
    skeleton: [],
    internal: ['Hyphae', 'Mycelium', 'Basidia', 'Spores', 'Context'],
    label: ['Cap', 'Gills', 'Stipe', 'Ring', 'Volva', 'Hyphae', 'Spores', 'Mycelium'],
    facts: 'The mushroom is only the fruiting body; the main organism is the mycelium, a network of hyphae in the soil or wood. Spores form on the gills or in the pores under the cap.',
  },
  {
    id: 'plant',
    group: 'plant',
    living: true,
    words: ['plant', 'plants', 'tree', 'shrub', 'bush', 'flower', 'herb', 'grass', 'fern', 'cactus', 'succulent', 'palm', 'vine', 'leaf', 'leaves', 'caladium', 'monstera', 'pothos', 'philodendron', 'orchid', 'rose', 'lily', 'sunflower', 'tulip', 'daisy', 'aloe', 'snake plant', 'ivy', 'bamboo', 'maize', 'cassava'],
    external: ['Leaf blade', 'Midrib', 'Leaf veins', 'Leaf margin', 'Petiole', 'Stem', 'Node', 'Internode', 'Bud', 'Root', 'Flower', 'Petal', 'Sepal', 'Stamen', 'Pistil', 'Fruit', 'Seed', 'Trunk', 'Bark', 'Branch', 'Spines', 'Areole', 'Frond'],
    skeleton: [],
    internal: ['Epidermis', 'Cuticle', 'Stomata', 'Palisade mesophyll', 'Spongy mesophyll', 'Xylem', 'Phloem', 'Vascular bundles', 'Cortex', 'Pith', 'Root hairs', 'Root cap'],
    label: ['Leaf veins', 'Midrib', 'Vascular bundles', 'Xylem', 'Phloem', 'Petiole', 'Stem', 'Root', 'Root hairs'],
    facts: 'Xylem carries water and minerals up from the roots; phloem carries sugars made in the leaves to the rest of the plant. Leaves make food by photosynthesis in the mesophyll and exchange gases through stomata. The petiole is the stalk that joins a leaf to the stem.',
  },
];

/** Common machines and objects: what is inside them. */
export const OBJECT_PLANS: BodyPlan[] = [
  {
    id: 'car',
    group: 'car or road vehicle',
    living: false,
    words: ['car', 'cars', 'vehicle', 'truck', 'lorry', 'van', 'minivan', 'bus', 'suv', 'crossover', 'jeep', 'sedan', 'saloon', 'hatchback', 'coupe', 'convertible', 'estate car', 'station wagon', 'pickup', 'taxi', 'electric car'],
    external: ['Bonnet', 'Bumper', 'Grille', 'Headlight', 'Windscreen', 'Wing mirror', 'Door', 'Door handle', 'Wheel', 'Tyre', 'Hubcap', 'Tail light', 'Boot', 'Number plate'],
    skeleton: ['Chassis', 'Body shell'],
    internal: ['Engine', 'Cylinders', 'Pistons', 'Crankshaft', 'Radiator', 'Battery', 'Alternator', 'Gearbox', 'Driveshaft', 'Exhaust system', 'Fuel tank', 'Brake discs', 'Suspension springs', 'Shock absorbers', 'Steering rack', 'Battery pack', 'Electric motor', 'Inverter', 'Reduction gear', 'Onboard charger', 'Half shafts'],
    label: ['Engine', 'Radiator', 'Battery', 'Gearbox', 'Driveshaft', 'Exhaust system', 'Fuel tank', 'Brake discs', 'Suspension springs', 'Steering rack', 'Chassis'],
    facts: 'In a petrol or diesel car, fuel burns in the cylinders and pushes the pistons, which turn the crankshaft; the gearbox and driveshaft carry that turning to the wheels. An electric car has a battery pack under the floor and electric motors instead of an engine, fuel tank and exhaust.',
  },
  {
    id: 'motorcycle',
    group: 'motorcycle',
    living: false,
    words: ['motorcycle', 'motorbike', 'scooter', 'okada', 'moped'],
    external: ['Fuel tank', 'Seat', 'Handlebars', 'Headlight', 'Mirror', 'Front fork', 'Front wheel', 'Rear wheel', 'Exhaust', 'Footpegs', 'Kickstand'],
    skeleton: ['Frame', 'Swingarm'],
    internal: ['Engine', 'Cylinder', 'Piston', 'Carburettor', 'Gearbox', 'Clutch', 'Drive chain', 'Battery', 'Spark plug', 'Brake discs', 'Rear shock absorber'],
    label: ['Engine', 'Cylinder', 'Piston', 'Carburettor', 'Gearbox', 'Clutch', 'Drive chain', 'Battery', 'Frame', 'Rear shock absorber', 'Brake discs'],
    facts: 'Most small motorcycles have a single-cylinder petrol engine with the gearbox in the same casing; a chain carries the drive to the rear wheel.',
  },
  {
    id: 'bicycle',
    group: 'bicycle',
    living: false,
    words: ['bicycle', 'bike', 'cycle', 'tricycle'],
    external: ['Frame', 'Handlebars', 'Saddle', 'Pedals', 'Crank', 'Chainring', 'Chain', 'Rear cassette', 'Derailleur', 'Front wheel', 'Rear wheel', 'Tyres', 'Spokes', 'Brakes'],
    skeleton: ['Frame', 'Fork'],
    internal: ['Bottom bracket bearings', 'Hub bearings', 'Headset bearings', 'Brake cables', 'Gear cables', 'Inner tubes'],
    label: ['Frame', 'Fork', 'Bottom bracket bearings', 'Hub bearings', 'Headset bearings', 'Chain', 'Brake cables', 'Gear cables'],
    facts: 'Pedalling turns the crank and chainring; the chain drives a sprocket on the rear hub, which has a freewheel so the wheel can spin while the pedals stop.',
  },
  {
    id: 'phone',
    group: 'smartphone or tablet',
    living: false,
    words: ['phone', 'smartphone', 'iphone', 'android', 'mobile', 'cellphone', 'tablet', 'ipad'],
    external: ['Screen', 'Front camera', 'Rear camera', 'Flash', 'Power button', 'Volume buttons', 'Charging port', 'Speaker grille', 'Frame'],
    skeleton: ['Frame', 'Back panel'],
    internal: ['Battery', 'Logic board', 'Processor', 'Memory chips', 'Camera modules', 'Speaker', 'Microphone', 'Vibration motor', 'Antennas', 'Display panel', 'SIM tray', 'Wireless charging coil'],
    label: ['Battery', 'Logic board', 'Processor', 'Memory chips', 'Camera modules', 'Speaker', 'Microphone', 'Vibration motor', 'Display panel', 'Antennas'],
    facts: 'Most of the inside of a phone is the battery; the processor, memory and radios sit on one small, stacked logic board.',
  },
  {
    id: 'laptop',
    group: 'laptop or computer',
    living: false,
    words: ['laptop', 'notebook', 'computer', 'pc', 'desktop', 'macbook'],
    external: ['Screen', 'Keyboard', 'Trackpad', 'Hinge', 'Ports', 'Webcam', 'Lid'],
    skeleton: ['Chassis'],
    internal: ['Motherboard', 'Processor', 'Memory', 'Storage drive', 'Battery', 'Cooling fan', 'Heat pipe', 'Wi-Fi card', 'Speakers', 'Power supply'],
    label: ['Motherboard', 'Processor', 'Memory', 'Storage drive', 'Battery', 'Cooling fan', 'Heat pipe', 'Wi-Fi card', 'Speakers'],
    facts: 'The processor and graphics chip make heat that heat pipes carry to a fan; storage is now usually a solid-state drive with no moving parts.',
  },
  {
    id: 'headphones',
    group: 'headphones',
    living: false,
    words: ['headphones', 'headphone', 'headset', 'earphones', 'earbuds', 'earpods'],
    external: ['Headband', 'Headband padding', 'Earcup', 'Ear cushion', 'Yoke', 'Buttons', 'Cable'],
    skeleton: ['Headband frame'],
    internal: ['Driver', 'Diaphragm', 'Magnet', 'Voice coil', 'Battery', 'Bluetooth board', 'Microphone'],
    label: ['Driver', 'Diaphragm', 'Magnet', 'Voice coil', 'Battery', 'Bluetooth board', 'Microphone', 'Headband frame'],
    facts: 'Each earcup holds a driver: a magnet and a voice coil move a thin diaphragm to make sound.',
  },
  {
    id: 'camera',
    group: 'camera',
    living: false,
    words: ['camera', 'dslr', 'mirrorless', 'camcorder'],
    external: ['Lens', 'Shutter button', 'Mode dial', 'Viewfinder', 'Screen', 'Flash', 'Grip', 'Hot shoe'],
    skeleton: ['Body'],
    internal: ['Image sensor', 'Shutter', 'Mirror', 'Processor', 'Battery', 'Memory card slot', 'Lens elements', 'Autofocus motor', 'Aperture blades'],
    label: ['Image sensor', 'Shutter', 'Mirror', 'Processor', 'Battery', 'Lens elements', 'Aperture blades', 'Autofocus motor'],
    facts: 'Light passes through the lens elements and aperture to the image sensor; in a DSLR a mirror sends it up to the viewfinder until the shutter opens.',
  },
  {
    id: 'kettle',
    group: 'electric kettle',
    living: false,
    words: ['kettle'],
    external: ['Body', 'Lid', 'Spout', 'Handle', 'Switch', 'Water gauge', 'Base'],
    skeleton: ['Body'],
    internal: ['Heating element', 'Thermostat', 'Limescale filter', 'Power connector'],
    label: ['Heating element', 'Thermostat', 'Limescale filter', 'Power connector', 'Water gauge'],
    facts: 'A heating element under the base heats the water; a bimetal thermostat switches it off when steam reaches it.',
  },
  {
    id: 'fridge',
    group: 'refrigerator',
    living: false,
    words: ['fridge', 'refrigerator', 'freezer'],
    external: ['Door', 'Handle', 'Door seal', 'Shelves', 'Crisper drawer'],
    skeleton: ['Cabinet'],
    internal: ['Compressor', 'Condenser coils', 'Evaporator', 'Expansion valve', 'Thermostat', 'Refrigerant pipes', 'Fan', 'Insulation'],
    label: ['Compressor', 'Condenser coils', 'Evaporator', 'Expansion valve', 'Thermostat', 'Refrigerant pipes', 'Insulation'],
    facts: 'The compressor pumps refrigerant round a loop: it takes in heat in the evaporator inside the cabinet and gives it off from the condenser coils at the back.',
  },
  {
    id: 'washing-machine',
    group: 'washing machine',
    living: false,
    words: ['washing machine', 'washer'],
    external: ['Door', 'Drum', 'Detergent drawer', 'Control panel', 'Feet'],
    skeleton: ['Cabinet'],
    internal: ['Motor', 'Drum bearings', 'Drain pump', 'Heating element', 'Shock absorbers', 'Inlet valve', 'Counterweight', 'Drive belt'],
    label: ['Motor', 'Drum bearings', 'Drain pump', 'Heating element', 'Shock absorbers', 'Inlet valve', 'Counterweight'],
    facts: 'A motor spins the drum through a belt or directly; heavy concrete counterweights and shock absorbers stop it shaking during the spin.',
  },
  {
    id: 'microwave',
    group: 'microwave oven',
    living: false,
    words: ['microwave'],
    external: ['Door', 'Control panel', 'Turntable', 'Handle'],
    skeleton: ['Cavity'],
    internal: ['Magnetron', 'High-voltage transformer', 'Capacitor', 'Waveguide', 'Turntable motor', 'Cooling fan'],
    label: ['Magnetron', 'High-voltage transformer', 'Capacitor', 'Waveguide', 'Turntable motor', 'Cooling fan'],
    facts: 'The magnetron makes microwaves that a waveguide carries into the metal cavity. The capacitor inside can hold a dangerous charge even when unplugged.',
  },
  {
    id: 'fan',
    group: 'electric fan',
    living: false,
    words: ['fan', 'ceiling fan', 'standing fan'],
    external: ['Blades', 'Guard', 'Hub', 'Stand', 'Base', 'Controls'],
    skeleton: ['Stand'],
    internal: ['Motor', 'Capacitor', 'Oscillation gearbox', 'Speed switch'],
    label: ['Motor', 'Capacitor', 'Oscillation gearbox', 'Speed switch', 'Blades'],
    facts: 'A small induction motor, started by a capacitor, turns the blades; a gearbox behind it swings the head from side to side.',
  },
  {
    id: 'watch',
    group: 'watch or clock',
    living: false,
    words: ['watch', 'wristwatch', 'clock'],
    external: ['Dial', 'Hands', 'Crown', 'Case', 'Bezel', 'Strap', 'Crystal'],
    skeleton: ['Case'],
    internal: ['Movement', 'Mainspring', 'Gear train', 'Escapement', 'Balance wheel', 'Quartz crystal', 'Battery', 'Stepper motor'],
    label: ['Movement', 'Mainspring', 'Gear train', 'Escapement', 'Balance wheel', 'Quartz crystal', 'Battery'],
    facts: 'A mechanical watch is powered by a mainspring and timed by a balance wheel and escapement; a quartz watch is timed by a vibrating quartz crystal and powered by a battery.',
  },
  {
    id: 'engine',
    group: 'engine or generator',
    living: false,
    words: ['engine', 'generator', 'motor', 'lawnmower', 'chainsaw'],
    external: ['Fuel tank', 'Pull starter', 'Air filter', 'Muffler', 'Frame', 'Control panel'],
    skeleton: ['Engine block', 'Frame'],
    internal: ['Cylinder', 'Piston', 'Connecting rod', 'Crankshaft', 'Spark plug', 'Carburettor', 'Flywheel', 'Alternator', 'Starter motor', 'Valves'],
    label: ['Cylinder', 'Piston', 'Connecting rod', 'Crankshaft', 'Spark plug', 'Carburettor', 'Flywheel', 'Alternator', 'Valves'],
    facts: 'In a four-stroke engine the piston draws in fuel and air, compresses it, is pushed down when the spark plug ignites it, then pushes out the exhaust. A generator’s engine turns an alternator to make electricity.',
  },
  {
    id: 'guitar',
    group: 'guitar',
    living: false,
    words: ['guitar', 'bass guitar', 'ukulele'],
    external: ['Headstock', 'Tuning pegs', 'Nut', 'Neck', 'Frets', 'Fretboard', 'Body', 'Sound hole', 'Bridge', 'Strings', 'Pickups'],
    skeleton: ['Body'],
    internal: ['Bracing', 'Truss rod', 'Neck joint', 'Pickup wiring', 'Potentiometers'],
    label: ['Bracing', 'Truss rod', 'Neck joint', 'Pickups', 'Bridge'],
    facts: 'In an acoustic guitar thin wooden braces under the top shape its sound; a steel truss rod in the neck resists the pull of the strings.',
  },
  {
    id: 'bag',
    group: 'bag',
    living: false,
    words: ['bag', 'handbag', 'tote', 'backpack', 'rucksack', 'purse', 'satchel', 'suitcase', 'luggage', 'wallet'],
    external: ['Handles', 'Shoulder strap', 'Body panel', 'Zip', 'Flap', 'Clasp', 'Rings', 'Rivets', 'Buckle', 'Front pocket', 'Base', 'Bag charm', 'Label patch'],
    skeleton: ['Base board'],
    internal: ['Lining', 'Interior pocket', 'Base board', 'Interfacing', 'Seams', 'Zip pocket'],
    label: ['Lining', 'Interior pocket', 'Base board', 'Interfacing', 'Seams'],
    facts: 'Most bags have an outer shell, a stiffening layer (interfacing) and a lining; a stiff board in the base keeps the shape.',
  },
  {
    id: 'shoe',
    group: 'shoe',
    living: false,
    words: ['shoe', 'shoes', 'sneaker', 'sneakers', 'trainer', 'boot', 'boots', 'sandal', 'heel', 'heels'],
    external: ['Upper', 'Toe box', 'Laces', 'Eyelets', 'Tongue', 'Collar', 'Heel counter', 'Midsole', 'Outsole'],
    skeleton: ['Shank'],
    internal: ['Insole', 'Footbed', 'Shank', 'Heel counter', 'Cushioning'],
    label: ['Insole', 'Shank', 'Heel counter', 'Cushioning', 'Midsole', 'Outsole'],
    facts: 'A shoe is built around a last: the upper is joined to the sole, a stiff heel counter holds the heel and a shank under the arch gives support.',
  },
];

const ALL = [...BODY_PLANS, ...OBJECT_PLANS];

/**
 * The plan for a named thing. Matches whole words in the name (and subcategory), preferring
 * the longest matching word, so "sea horse" is a fish and "horsefly" is an insect.
 */
export function bodyPlanFor(name: string, category: string, subcategory?: string | null): BodyPlan | null {
  const text = ` ${`${name} ${subcategory ?? ''}`.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `;
  // The category decides the family of plans: a "fly agaric" is a fungus, not an insect.
  if (category === 'plant') return BODY_PLANS.find((p) => p.id === 'plant')!;
  if (category === 'fungus') return BODY_PLANS.find((p) => p.id === 'fungus')!;
  const animals = BODY_PLANS.filter((p) => p.id !== 'plant' && p.id !== 'fungus');
  let best: { plan: BodyPlan; len: number } | null = null;
  for (const plan of category === 'animal' ? animals : category === 'other' ? ALL : OBJECT_PLANS) {
    for (const w of plan.words) {
      if (text.includes(` ${w} `) && (!best || w.length > best.len)) best = { plan, len: w.length };
    }
  }
  // Compound names that contain a misleading word.
  if (category === 'animal' && /\b(sea ?horse)\b/.test(text)) return BODY_PLANS.find((p) => p.id === 'fish')!;
  if (category === 'animal' && /\bhorse ?fl(y|ies)\b|\bbutterfl(y|ies)\b|\bdragonfl(y|ies)\b|\bfirefl(y|ies)\b/.test(text)) return BODY_PLANS.find((p) => p.id === 'insect')!;
  return best?.plan ?? null;
}

/**
 * The plan for an identified object, using every name it has, not only the main one: a car
 * called by its model ("BYD Atto 3") is still found as a car through its kind ("compact SUV"),
 * its other candidate names, or the first sentence of its summary. A vehicle that matches
 * nothing more specific is treated as a car.
 */
export function planForObject(d: {
  displayName: string;
  category: string;
  subcategory?: string | null;
  candidates?: Array<{ name: string; likelihood?: number }>;
  summary?: string;
}): BodyPlan | null {
  const firstSentence = (d.summary ?? '').split(/(?<=[.!?])\s/)[0] ?? '';
  // Only the most likely candidate: a weaker guess of another kind ("kettle" for a moka pot) would mislead.
  const top = [...(d.candidates ?? [])].sort((a, b) => (b.likelihood ?? 0) - (a.likelihood ?? 0))[0]?.name ?? '';
  const tries = [`${d.displayName} ${d.subcategory ?? ''}`, firstSentence, top];
  for (const t of tries) {
    if (!t.trim()) continue;
    const plan = bodyPlanFor(t, d.category, null);
    if (plan) return plan;
  }
  if (d.category === 'vehicle') return OBJECT_PLANS.find((p) => p.id === 'car') ?? null;
  return null;
}

/** Kinds that have their own inside: an electric car has no engine, fuel tank or exhaust. */
const VARIANTS: Array<{ plan: string; when: RegExp; unless?: RegExp; label: string[] }> = [
  {
    plan: 'car',
    when: /\b(?:electric (?:car|vehicle|suv|crossover|hatchback|sedan|saloon|van|truck|pickup|coupe)s?|(?:all|fully|battery)[- ]electric|evs?|bevs?|tesla|byd|nio|xpeng|polestar|rivian|lucid|ioniq|e-tron|taycan|atto|mach-e)\b/i,
    unless: /\b(?:hybrid|phev|plug-in hybrid|petrol|diesel|gasoline)\b/i,
    label: ['Battery pack', 'Electric motor', 'Inverter', 'Reduction gear', 'Half shafts', 'Radiator', 'Brake discs', 'Suspension springs', 'Shock absorbers', 'Steering rack', 'Chassis'],
  },
];

/** What the inside drawing labels for this object: the plan's list, or its variant's (an electric car's). */
export function labelsFor(plan: BodyPlan, text: string): string[] {
  const v = VARIANTS.find((x) => x.plan === plan.id && x.when.test(text) && !(x.unless && x.unless.test(text)));
  return v ? v.label : plan.label;
}

/** The reference, written for a model to use (names and facts only; it is data, not instructions). */
export function planReference(plan: BodyPlan): string {
  return [
    `Correct terms for a ${plan.group}:`,
    `- Outside: ${plan.external.join(', ')}.`,
    plan.skeleton.length ? `- ${plan.living ? 'Skeleton' : 'Frame'}: ${plan.skeleton.join(', ')}.` : '',
    `- ${plan.living ? 'Organs and inner structures' : 'Inner parts'}: ${plan.internal.join(', ')}.`,
    `- Facts that are easy to get wrong: ${plan.facts}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** The word in the name that matched the plan ("cow" in "Holstein Friesian cow"), else the last word. */
export function planKeyword(name: string, plan: BodyPlan | null): string {
  const text = ` ${name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `;
  const hit = plan?.words.filter((w) => text.includes(` ${w} `)).sort((a, b) => b.length - a.length)[0];
  // A model or brand name ("BYD Atto 3") has no kind word: use the plan's own ("car").
  return hit ?? plan?.words[0] ?? (name.trim().split(/\s+/).at(-1) ?? name).toLowerCase();
}

/** Searches for real pictures of the inside: a skeleton and the organs, or a cutaway of the machine. */
export function referenceQueries(name: string, plan: BodyPlan | null): string[] {
  const k = planKeyword(name, plan);
  if (!plan) return [`${k} cutaway`, `${k} internal parts`, `${k} cross section`];
  if (plan.id === 'plant') return [`${k} anatomy`, 'leaf cross section', 'plant stem cross section'];
  if (plan.id === 'fungus') return [`${k} anatomy`, 'mushroom anatomy'];
  if (plan.living) return [`${k} skeleton`, `${k} anatomy organs`, `${k} internal anatomy`, `${plan.group.split(' ')[0]} anatomy`];
  return [`${k} cutaway`, `${k} internal parts`, `${k} exploded view`];
}

/**
 * A short key for the kind of object, so what someone teaches about one car applies to their
 * other cars: the body plan ("car", "ruminant"), or else the last word of its name ("kettle").
 */
export function kindKey(d: { displayName: string; category: string; subcategory?: string | null; candidates?: Array<{ name: string; likelihood?: number }>; summary?: string }): string {
  const plan = planForObject(d);
  if (plan) return plan.id;
  const words = d.displayName.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !/^\d+$/.test(w));
  return (words.at(-1) ?? d.category).slice(0, 40);
}

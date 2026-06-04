// Opening book - maps FEN position (without move counters) to opening name
const OPENINGS_BY_FEN = {
  // 1. e4
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3': "King's Pawn Opening",
  // 1. d4
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3': "Queen's Pawn Opening",
  // 1. c4
  'rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq c3': 'English Opening',
  // 1. Nf3
  'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq -': 'Reti Opening',
  // 1. g3
  'rnbqkbnr/pppppppp/8/8/8/6P1/PPPPPP1P/RNBQKBNR b KQkq -': "King's Fianchetto Opening",
  // 1. b3
  'rnbqkbnr/pppppppp/8/8/8/1P6/P1PPPPPP/RNBQKBNR b KQkq -': "Nimzo-Larsen Attack",
  // 1. f4
  'rnbqkbnr/pppppppp/8/8/5P2/8/PPPPP1PP/RNBQKBNR b KQkq f3': 'Bird Opening',

  // Sicilian Defense: 1. e4 c5
  'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6': 'Sicilian Defense',
  'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -': 'Sicilian Defense',
  'r1bqkbnr/pp1ppppp/2n5/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -': 'Sicilian Defense',
  'r1bqkbnr/pp1ppppp/2n5/2p5/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq d3': 'Sicilian Defense: Open',
  'r1bqkbnr/pp1ppp1p/2n3p1/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -': 'Sicilian Defense: Accelerated Dragon',
  'rnbqkbnr/pp1ppppp/8/2p5/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq -': 'Sicilian Defense: Closed',
  'r1bqkb1r/pp1ppppp/2n2n2/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -': 'Sicilian Defense',
  'rnbqkbnr/pp2pppp/3p4/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -': 'Sicilian Defense',
  'rnbqkbnr/pp2pppp/3p4/2p5/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq d3': 'Sicilian Defense: Open',
  'r1bqkbnr/pp2pppp/2np4/2p5/3PP3/5N2/PPP2PPP/RNBQKB1R w KQkq -': 'Sicilian Defense: Open',
  'rnbqkb1r/pp2pppp/3p1n2/2p5/3PP3/5N2/PPP2PPP/RNBQKB1R w KQkq -': 'Sicilian Defense: Najdorf Variation',

  // French Defense: 1. e4 e6
  'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -': 'French Defense',
  'rnbqkbnr/pppp1ppp/4p3/8/4PP2/8/PPPP2PP/RNBQKBNR b KQkq f3': 'French Defense',
  'rnbqkbnr/ppp2ppp/4p3/3p4/4PP2/8/PPPP2PP/RNBQKBNR w KQkq d6': 'French Defense',
  'rnbqkbnr/pppp1ppp/4p3/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3': 'French Defense',
  'rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq d6': 'French Defense',
  'rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq -': 'French Defense: Normal Variation',
  'rnbqkb1r/ppp2ppp/4pn2/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR w KQkq -': 'French Defense: Classical Variation',
  'rnbqkbnr/ppp2ppp/4p3/3pP3/3P4/8/PPP2PPP/RNBQKBNR b KQkq -': 'French Defense: Advance Variation',
  'rnbqkbnr/ppp2ppp/4p3/3P4/3P4/8/PPP2PPP/RNBQKBNR b KQkq -': 'French Defense: Exchange Variation',

  // Caro-Kann: 1. e4 c6
  'rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -': 'Caro-Kann Defense',
  'rnbqkbnr/pp1ppppp/2p5/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3': 'Caro-Kann Defense',
  'rnbqkbnr/pp2pppp/2p5/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq d6': 'Caro-Kann Defense',
  'rnbqkbnr/pp2pppp/2p5/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq -': 'Caro-Kann Defense: Main Line',

  // Italian / Giuoco Piano: 1. e4 e5 2. Nf3 Nc6 3. Bc4
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6': "King's Pawn Game",
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -': "King's Knight Opening",
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -': "King's Knight Opening",
  'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq -': 'Italian Game',
  'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -': 'Giuoco Piano',
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -': 'Two Knights Defense',
  'r1bqk1nr/pppp1ppp/2n5/2b1p3/2BPP3/5N2/PPP2PPP/RNBQK2R b KQkq d3': 'Giuoco Piano: Main Line',

  // Ruy Lopez: 1. e4 e5 2. Nf3 Nc6 3. Bb5
  'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq -': 'Ruy Lopez',
  'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq -': 'Ruy Lopez: Morphy Defense',
  'r1bqkbnr/1ppp1ppp/p1n5/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R b KQkq -': 'Ruy Lopez: Morphy Defense',

  // Scotch Game: 1. e4 e5 2. Nf3 Nc6 3. d4
  'r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq d3': 'Scotch Game',

  // Philidor Defense: 1. e4 e5 2. Nf3 d6
  'rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -': 'Philidor Defense',

  // Petrov Defense: 1. e4 e5 2. Nf3 Nf6
  'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -': "Petrov's Defense",

  // Queen's Gambit: 1. d4 d5 2. c4
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3': "Queen's Pawn Opening",
  'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq d6': "Queen's Pawn Game",
  'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3': "Queen's Gambit",
  'rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq -': "Queen's Gambit Declined",
  'rnbqkbnr/ppp1pppp/8/8/2pP4/8/PP2PPPP/RNBQKBNR w KQkq -': "Queen's Gambit Accepted",
  'rnbqkbnr/ppp1pppp/8/3p4/2PP4/5N2/PP2PPPP/RNBQKB1R b KQkq -': "Queen's Gambit",

  // Slav Defense: 1. d4 d5 2. c4 c6
  'rnbqkbnr/pp2pppp/2p5/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq -': 'Slav Defense',
  'rnbqkbnr/pp2pppp/2p5/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR b KQkq -': 'Slav Defense',

  // King's Indian: 1. d4 Nf6 2. c4 g6
  'rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w KQkq -': 'Indian Defense',
  'rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3': 'Indian Defense',
  'rnbqkb1r/pppppp1p/5np1/8/2PP4/8/PP2PPPP/RNBQKBNR w KQkq -': "King's Indian Defense",
  'rnbqkb1r/pppppp1p/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR b KQkq -': "King's Indian Defense",
  'rnbqk2r/ppppppbp/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq -': "King's Indian Defense",

  // Nimzo-Indian: 1. d4 Nf6 2. c4 e6 3. Nc3 Bb4
  'rnbqkb1r/pppp1ppp/4pn2/8/2PP4/8/PP2PPPP/RNBQKBNR w KQkq -': 'Indian Defense',
  'rnbqkb1r/pppp1ppp/4pn2/8/2PP4/2N5/PP2PPPP/R1BQKBNR b KQkq -': 'Indian Defense',
  'rnbqk2r/pppp1ppp/4pn2/8/1bPP4/2N5/PP2PPPP/R1BQKBNR w KQkq -': 'Nimzo-Indian Defense',

  // Grunfeld: 1. d4 Nf6 2. c4 g6 3. Nc3 d5
  'rnbqkb1r/ppp1pp1p/5np1/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq d6': 'Grunfeld Defense',

  // Dutch Defense: 1. d4 f5
  'rnbqkbnr/ppppp1pp/8/5p2/3P4/8/PPP1PPPP/RNBQKBNR w KQkq f6': 'Dutch Defense',

  // London System: 1. d4 d5 2. Bf4 / 1. d4 Nf6 2. Bf4
  'rnbqkbnr/ppp1pppp/8/3p4/3P1B2/8/PPP1PPPP/RN1QKBNR b KQkq -': 'London System',
  'rnbqkb1r/pppppppp/5n2/8/3P1B2/8/PPP1PPPP/RN1QKBNR b KQkq -': 'London System',

  // Scandinavian: 1. e4 d5
  'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6': 'Scandinavian Defense',
  'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq -': 'Scandinavian Defense',

  // Pirc Defense: 1. e4 d6
  'rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -': 'Pirc Defense',
  'rnbqkbnr/ppp1pppp/3p4/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3': 'Pirc Defense',

  // Alekhine Defense: 1. e4 Nf6
  'rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -': "Alekhine's Defense",

  // Vienna Game: 1. e4 e5 2. Nc3
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq -': 'Vienna Game',

  // King's Gambit: 1. e4 e5 2. f4
  'rnbqkbnr/pppp1ppp/8/4p3/4PP2/8/PPPP2PP/RNBQKBNR b KQkq f3': "King's Gambit",

  // English: 1. c4 e5
  'rnbqkbnr/pppp1ppp/8/4p3/2P5/8/PP1PPPPP/RNBQKBNR w KQkq e6': 'English Opening: Reversed Sicilian',

  // Catalan: 1. d4 Nf6 2. c4 e6 3. g3
  'rnbqkb1r/pppp1ppp/4pn2/8/2PP4/6P1/PP2PP1P/RNBQKBNR b KQkq -': 'Catalan Opening',
};

// Look up opening name from current FEN
function getOpeningName(fen) {
  if (!fen) return '';
  // Strip the halfmove clock and fullmove number from FEN
  const parts = fen.split(' ');
  if (parts.length >= 4) {
    const key = parts.slice(0, 4).join(' ');
    if (OPENINGS_BY_FEN[key]) return OPENINGS_BY_FEN[key];
  }
  return '';
}

// Find the last known opening name by replaying moves
function findOpeningName(chess) {
  if (!chess) return '';
  const history = chess.history();
  if (history.length === 0) return '';

  // Create a temporary chess instance to replay moves
  const temp = new Chess();
  let lastOpening = '';

  for (let i = 0; i < history.length; i++) {
    temp.move(history[i]);
    const name = getOpeningName(temp.fen());
    if (name) lastOpening = name;
  }

  return lastOpening;
}

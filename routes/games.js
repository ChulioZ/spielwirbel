'use strict';

/* Routes for the games of a round: add (with image), retire/restore.
   Mounted under /api/rounds/:rid/games (mergeParams for rid). */

const express = require('express');
const { saveData, id, findRound, pushActivity } = require('../lib/store');
const upload = require('../lib/upload');

const router = express.Router({ mergeParams: true });

router.post('/', upload.single('image'), (req, res) => {
  const round = findRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const title = String(req.body.title || '').trim();
  const type = req.body.type === 'digital' ? 'digital' : 'analog';
  if (!title) return res.status(400).json({ error: 'Title is missing' });

  const game = {
    id: id(),
    title,
    type,
    image: req.file ? '/uploads/' + req.file.filename : null,
    retired: false,
    retiredAt: null,
  };
  round.games.push(game);
  pushActivity(round, 'game_added', { gameId: game.id, title: game.title });
  saveData();
  res.status(201).json(game);
});

// Retire a game (or take it back into the collection). The game is kept, only
// flagged as retired with a timestamp.
router.post('/:gid/retire', (req, res) => {
  const round = findRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const game = round.games.find((g) => g.id === req.params.gid);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const retired = req.body.retired !== false; // default: true
  game.retired = retired;
  game.retiredAt = retired ? new Date().toISOString() : null;
  pushActivity(round, retired ? 'game_retired' : 'game_restored', {
    gameId: game.id,
    title: game.title,
  });
  saveData();
  res.json(game);
});

module.exports = router;

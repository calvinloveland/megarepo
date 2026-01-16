// index.js under the routes folder
const express = require("express");
// https://expressjs.com/en/guide/routing.html#express-router
const router = express.Router();
router.get("/", (req, res) => {
    // renders the index.ejs page
    res.render("index", {
        // This gets rendered as the browsers title
        // it is passed into the ejs page as the variable 'title'
        title: "Silk"
    })
});

router.get("/submit", (req, res) => {
    // renders the submit.ejs page
    res.render("submit", {
        // This gets rendered as the browsers title
        // it is passed into the ejs page as the variable 'title'
        title: "Silk | Submit"
    })
});

router.get("/grades", (req, res) => {
    // renders the grades.ejs page
    res.render("grades", {
        // This gets rendered as the browsers title
        // it is passed into the ejs page as the variable 'title'
        title: "Silk | Grades"
    })
});
module.exports = router;

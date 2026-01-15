<?php
$skillsFile = fopen("skills.csv", "r");
$skills = array();
$type = $_GET["type"];
while (!feof($skillsFile)) {
    $line = fgets($skillsFile);
    $values = explode(",", $line);
    if (empty($type) || $type == "all" || trim($values[1]) == $type)
        echo($values[0] . "\n");
}

?>

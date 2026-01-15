<!DOCTYPE html>
<html>
<head>
	<title>Synonym Roll</title>
	<link rel="stylesheet"  type="text/css" href="styles.css"/>
</head>
<body>
	<h1>
		<?php 
			error_reporting(0);
			$file = fopen("../protected/key.txt","r");
			$key = fgets($file);
			fclose($file);
			$key = trim($key);
			if(empty($_GET["word"])){
				echo"SynonymRoll.net";}
			else{
				$word = $_GET["word"];
				$api_results= unserialize(file_get_contents("http://words.bighugelabs.com/api/2/$key/$word/php"));
				if(empty($api_results["noun"])){
					$api_results["noun"]=array("syn" => array(""));}
				if(empty($api_results["verb"])){
					$api_results["verb"]=array("syn" => array(""));}
				$synonyms = array_merge($api_results["noun"]["syn"],$api_results["verb"]["syn"]);
				echo("Some synonyms of ".$word." are: ");
				foreach($synonyms as &$synonym){
					if($synonym != ""){
						echo $synonym.", ";}}	
			}
		?>
	</h1>
	<form onsubmit="spinTime()">
		<input type="text" name="word" id="word-input" placeholder="Enter a word"/>
		<br/>
		<input type="image" src="roll.jpg"  alt="Submit Form" id="submit-image" class="" />
	</form>
	<script>
		function spinTime() {
			document.getElementById("submit-image").className += " spinning";
			document.querySelector("form").submit();
		}
	</script>
	<div id="footer">Created by <a href="https://calvinloveland.com">Calvin Loveland</a>. Hire me! <div>
</body>
</html>


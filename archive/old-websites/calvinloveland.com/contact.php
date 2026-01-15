<!DOCTYPE html>
<html lang="en">
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Calvin Loveland</title>
    <link rel="stylesheet" type="text/css" href="styles.css">
</head>
<body>
<div id="main">
    <?php include("header.html"); ?>
    <div id="body">
        <h1>Contact Me:</h1>
        <form id="contact">
            <label for="first_name">First Name</label>
            <br>
            <input type="text" name="first_name" maxlength="30"
                   size="30" <?php if (isset($_GET['first_name'])) echo 'value="' . $_GET['first_name'] . '"'; ?>/>
            <br>
            <label for="last_name">Last Name</label>
            <br>
            <input type="text" name="last_name" maxlength="30"
                   size="30" <?php if (isset($_GET['last_name'])) echo 'value="' . $_GET['last_name'] . '"'; ?>/>
            <br>
            <label for="email">Email</label>
            <br>
            <input type="text" name="email" maxlength="100"
                   size="30" <?php if (isset($_GET['email'])) echo 'value="' . $_GET['email'] . '"'; ?>/>
            <br>
            <label for="subject">Subject</label>
            <br>
            <input type="text" name="subject" maxlength="50"
                   size="30" <?php if (isset($_GET['subject'])) echo 'value="' . $_GET['subject'] . '"'; ?>/>
            <br>
            <label for="message">Message</label>
            <br>
            <textarea name="message"><?php if (isset($_GET['message'])) echo $_GET['message']; ?></textarea>
            <br>
            <input type="submit">
        </form>
        <?php
        if (isset($_GET['email'], $_GET['first_name'], $_GET['last_name'], $_GET['message'], $_GET['subject']) &&
            !empty($_GET['email']) &&
            !empty($_GET['first_name']) &&
            !empty($_GET['last_name']) &&
            !empty($_GET['message']) &&
            !empty($_GET['subject'])
        ) {

            $to = 'calvinloveland@gmail.com';
            $subject = 'WEBSITE: '.$_GET['subject'] . ' - ' . $_GET['first_name'] . ' ' . $_GET['last_name'];
            $message = $_GET['message'];
            $message = wordwrap($message, 70, "\r\n");
            $headers = 'From: ' . $_GET['email'] . "\r\n" .
                'Reply-To: ' . $_GET['email'] . "\r\n" .
                'X-Mailer: PHP/' . phpversion();
            mail($to, $subject, $message, $headers);
            echo('<p>Thanks for reaching out, I\'ll get back to you as soon as I can</p>');
        } else {
            echo('<p>All field are required</p>');
        }
        ?>
    </div>
</div>
</body>
</html>

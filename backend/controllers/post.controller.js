import cloudinary from "../lib/cloudinary.js";
import Post from "../models/post.model.js";
import Notification from "../models/notification.model.js";
import { sendCommentNotificationEmail } from "../emails/emailHandlers.js";
import axios from 'axios';

export const getPublicPosts = async (req, res) => {
    try {
        const posts = await Post
            .find()
            .populate( // super useful
                "author",
                "name username profilePicture headline"
            )
            .populate(
                "comments.user",
                "name profilePicture"
            )
            .sort({ createdAt: -1});

        const filteredPosts = posts.filter(post => post.author !== null);

        res.status(200).json(filteredPosts);
    }
    catch (error) {
        console.error("Error in getPublicPosts controller:", error);
        res.status(500).json({ message: "Server error" });
    }
}

export const getPersonalizedExploreFeed = async (req, res) => {
    try {
        const posts = await Post
            .find()
            .populate( // super useful
                "author",
                "name username profilePicture headline"
            )
            .populate(
                "comments.user",
                "name profilePicture"
            )
            .sort({ createdAt: -1});

        const filteredPosts = posts.filter(post => post.author !== null);
        
        console.log('personalized posts', filteredPosts.length);

        res.status(200).json(filteredPosts);
    }
    catch (error) {
        console.error("Error in getPersonalizedExploreFeed controller:", error);
        res.status(500).json({ message: "Server error" });
    }
}

export const getNetworkPosts = async (req, res) => {
    try {
        const posts = await Post
            .find(
                {
                    author: {$in: [...req.user.connections, req.user._id]}
                }
            )
            .populate( // super useful
                "author",
                "name username profilePicture headline"
            )
            .populate(
                "comments.user",
                "name profilePicture"
            )
            .sort({ createdAt: -1});

        const filteredPosts = posts.filter(post => post.author !== null);

        console.log('network posts', filteredPosts.length);

        res.status(200).json(filteredPosts);
    }
    catch (error) {
        console.error("Error in getNetworkPosts controller:", error);
        res.status(500).json({ message: "Server error" });
    }
}

export const createPost = async (req, res) => {
    try {
        const { content, image } = req.body;

        let newPost;
        let sentimentResult = null;

        // Try to perform sentiment analysis
        try {
            const { data } = await axios.post(
                process.env.SENTIMENT_ANALYSIS_URL,
                { text: content }
            );
            sentimentResult = data;
            console.log('Sentiment analysis result:', sentimentResult);
        } catch (error) {
            console.error('Sentiment analysis server unavailable, skipping sentiment analysis.');
            // If the sentiment server is not reachable, continue without sentiment data
        }

        // Check if there's an image and upload if necessary
        if (image) {
            const imgResult = await cloudinary.uploader.upload(image);
            newPost = new Post({
                author: req.user._id,
                content,
                image: imgResult.secure_url,
                sentiment: sentimentResult
            });
        } else {
            newPost = new Post({
                author: req.user._id,
                content,
                sentiment: sentimentResult
            });
        }

        // Save the new post
        await newPost.save();

        // Return the new post as the response
        res.status(201).json(newPost);
    } catch (error) {
        console.error("Error in createPost controller:", error);
        res.status(500).json({ message: "Server error" });
    }
};

export const deletePost = async (req, res) => {
    console.log('delete post has been called!');
    try {
        const postId = req.params.id;
        const userId = req.user._id;

        const post = await Post.findById(postId);

        if (!post) {
            return res.status(404).json({ message: "Post not found" });
        }

        // check if the current user is the author of the post
        if (post.author.toString() !== userId.toString()) {
            return res.status(403).json({ message: "You are not authorized to delete this post" }); // 403 <==> unauth
        }

        if (post.image) { // delete the img from the cloudinary as well
            // destroy function takes as an argument the img id;
            // pop will give us the last element from the splitted url and .split(".")[0] will get rid of .png suffix: 
            await cloudinary.uploader.destroy(post.image.split("/").pop().split(".")[0]);
        }

        await Post.findByIdAndDelete(postId);

        res.status(200).json({ message: "Post deleted successfully" });
    }
    catch (error) {
        console.log("Error in delete post controller", error.message);
        res.status(500).json({ message: "Server error" });
    }    
}

export const getPostById = async (req, res) => {
    try {
        const postId = req.params.id;
        const post = await Post
            .findById(postId)
            .populate(
                "author",
                "name username profilePicture headline"
            )        
            .populate("comments.user", "name profilePicture username headline");

        res.status(200).json(post);
    }
    catch (error) {
        console.error("Error in getPostById controller:", error);
        res.status(500).json({ messsage: "Server error" });
    }    
}

export const createComment = async (req, res) => {
    try {
        const postId = req.params.id;
        const { content } = req.body;
        
        const post = await Post
            .findByIdAndUpdate(
                postId,
                {
                    $push: {
                        comments: {
                            user: req.user._id, 
                            content
                        }
                    },
                },
                { new: true } // this will make findByIdAndUpdate return the newly created comment used by populate
            )
            .populate(
                "author",
                "name email username headline profilePicture"
            );

        // create a notification if the comment owner is not the post owner:
        if (post.author._id.toString() !== req.user._id.toString()) {
            const newNotification = new Notification(
                {
                    recipient: post.author,
                    type: "comment",
                    relatedUser: req.user._id,
                    relatedPost: postId
                }
            );

            await newNotification.save();
            
            // send email:
            try {
                const postUrl = process.env.CLIENT_URL + "/post/" + postId;

                await sendCommentNotificationEmail(
                    post.author.email,
                    post.author.name,
                    req.user.name,
                    postUrl,
                    content
                );    
            } 
            catch (error) {
                console.log("Error in sending comment notification email:", error);
            }
        }

        res.status(200).json(post);
    }
    catch (error) {
        console.error("Error in createComment controller:", errors);
        res.status(500).json({ message: "Server error" });        
    }    
}

export const likePost = async (req, res) => {
    try {
        const postId = req.params.id;
        const post = await Post.findById(postId);
        const userId = req.user._id;

        if (post.likes.includes(userId)) {
            // unlike the post:
            post.likes = post.likes.filter(id => { id.toString() !== userId.toString() });
        }
        else {
            // like the post:
            post.likes.push(userId);

            // create a notification if the post owner is not the user who liked:
            if (post.author.toString() !== userId.toString) {
                const newNotification = new Notification(
                    {
                        recipient: post.author,
                        type: "like",
                        relatedUser: userId,
                        relatedPost: postId
                    }
                )

                await newNotification.save();
            }
        }

        await post.save();

        res.status(200).json(post);
    }
    catch (error) {
        console.error("Error in likePost controller", error);
        res.status(500).json({ message: "Server error" });
    }
}
